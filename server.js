// server.js

import { PrismaClient } from "@prisma/client";
import bodyParser from "body-parser";
import crypto from "crypto";
import express from "express";
import fetch from "node-fetch";

// Initialisation Prisma
const prisma = new PrismaClient();

// Configuration du serveur Express
const app = express();

// Middleware pour capturer le corps brut de la requête
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Middleware CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Middleware bodyParser
app.use(bodyParser.json());

// Configuration des clés et variables d'environnement
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;
const BACKEND_URL = process.env.BACKEND_URL;
const PORT = process.env.PORT || 3000;

// Montants de base pour les abonnements
const baseAmounts = {
  "1_month": 19.99,
  "3_months": 49.99,
  "6_months": 79.99,
  "12_months": 139.99,
};

// Fonctions utilitaires liées à la base de données (via Prisma)
async function getUser(stakeUsername) {
  console.log(`Recherche de l'utilisateur: ${stakeUsername}`);
  const user = await prisma.user.findUnique({
    where: {
      stake_username: stakeUsername,
    },
  });
  console.log(`Utilisateur ${stakeUsername} ${user ? "trouvé" : "non trouvé"}`);
  return user;
}

async function addUser(
  stakeUsername,
  subscriptionType,
  subscriptionStart,
  subscriptionEnd,
  referralUsername
) {
  console.log(`Ajout de l'utilisateur: ${stakeUsername}`);
  const result = await prisma.user.create({
    data: {
      stake_username: stakeUsername,
      subscription_type: subscriptionType,
      subscription_start: subscriptionStart,
      subscription_end: subscriptionEnd,
      referral_username: referralUsername,
    },
  });
  console.log(`Utilisateur ajouté avec l'ID: ${result.id}`);
  return result.id;
}

async function countValidAffiliates(referralUsername) {
  console.log(`Comptage des affiliés valides pour: ${referralUsername}`);
  const now = new Date();
  const count = await prisma.user.count({
    where: {
      referral_username: referralUsername,
      subscription_end: {
        gte: now,
      },
    },
  });
  console.log(`Nombre d'affiliés valides pour ${referralUsername}: ${count}`);
  return count;
}

async function updateUserSubscription(
  stakeUsername,
  subscriptionType,
  subscriptionEnd,
  referralUsername
) {
  console.log(`Mise à jour de l'abonnement pour: ${stakeUsername}`);
  const user = await getUser(stakeUsername);

  let dataToUpdate = {
    subscription_type: subscriptionType,
    subscription_end: subscriptionEnd,
  };

  // Si l'utilisateur n'a pas de referral_username et qu'on en fournit un
  if (!user?.referral_username && referralUsername) {
    dataToUpdate.referral_username = referralUsername;
  }

  const result = await prisma.user.updateMany({
    where: {
      stake_username: stakeUsername,
    },
    data: dataToUpdate,
  });
  console.log(
    `Abonnement mis à jour pour ${stakeUsername}, documents modifiés: ${result.count}`
  );
  return result.count;
}

async function createInvoice(
  txnId,
  orderNumber,
  stakeUsername,
  subscriptionType,
  amount,
  currency,
  status,
  promoCode,
  referralUsername
) {
  console.log(
    `Création de l'invoice pour l'utilisateur: ${stakeUsername}, Order Number: ${orderNumber}`
  );
  const result = await prisma.invoice.create({
    data: {
      txn_id: txnId,
      order_number: orderNumber,
      stake_username: stakeUsername,
      subscription_type: subscriptionType,
      amount: amount,
      currency: currency,
      status: status,
      promoCode: promoCode,
      referralUsername: referralUsername,
    },
  });
  console.log(`Invoice créée avec l'ID: ${result.id}`);
  return result.id;
}

async function updateInvoiceStatus(orderNumber, status, txnId) {
  console.log(`Mise à jour du statut de l'invoice: ${orderNumber} à ${status}`);
  const result = await prisma.invoice.updateMany({
    where: { order_number: orderNumber },
    data: {
      status: status,
      txn_id: txnId,
      updated_at: new Date(),
    },
  });
  console.log(
    `Statut de l'invoice ${orderNumber} mis à jour, documents modifiés: ${result.count}`
  );
  return result.count;
}

async function getInvoice(orderNumber) {
  console.log(`Récupération de l'invoice pour l'Order Number: ${orderNumber}`);
  const invoice = await prisma.invoice.findUnique({
    where: { order_number: orderNumber },
  });
  console.log(`Invoice ${orderNumber} ${invoice ? "trouvée" : "non trouvée"}`);
  return invoice;
}

async function verifyPromoCode(promoCode, subscriptionType) {
  console.log(
    `Vérification du code promo: ${promoCode} pour l'abonnement: ${subscriptionType}`
  );
  const promo = await prisma.promo.findUnique({
    where: {
      code: promoCode,
    },
  });

  if (!promo) {
    console.log(`Code promo invalide: ${promoCode}`);
    return { isValid: false, message: "Code promo invalide." };
  }

  const now = new Date();
  if (now > promo.expirationDate) {
    console.log(`Code promo expiré: ${promoCode}`);
    return { isValid: false, message: "Ce code promo a expiré." };
  }

  if (promo.usageLimit <= 0) {
    console.log(`Code promo atteint sa limite d'utilisation: ${promoCode}`);
    return {
      isValid: false,
      message: "Ce code promo a atteint sa limite d'utilisation.",
    };
  }

  if (!promo.applicableDurations.includes(subscriptionType)) {
    console.log(
      `Code promo non applicable pour le type d'abonnement: ${subscriptionType}`
    );
    return {
      isValid: false,
      message:
        "Ce code promo n'est pas applicable pour la durée d'abonnement sélectionnée.",
    };
  }

  console.log(`Code promo valide: ${promoCode}, remise: ${promo.discount}`);
  return { isValid: true, discount: promo.discount };
}

async function usePromoCode(promoCode) {
  console.log(`Utilisation du code promo: ${promoCode}`);
  const result = await prisma.promo.updateMany({
    where: { code: promoCode },
    data: {
      usageLimit: {
        decrement: 1,
      },
    },
  });
  const success = result.count === 1;
  console.log(`Code promo ${promoCode} utilisé: ${success}`);
  return success;
}

async function revertPromoCode(promoCode) {
  console.log(`Réinitialisation du code promo: ${promoCode}`);
  const result = await prisma.promo.updateMany({
    where: { code: promoCode },
    data: {
      usageLimit: {
        increment: 1,
      },
    },
  });
  const success = result.count === 1;
  console.log(`Code promo ${promoCode} réinitialisé: ${success}`);
  return success;
}

// Fonction pour calculer la date de fin d'abonnement
function calculateSubscriptionEnd(subscriptionType) {
  const now = new Date();
  switch (subscriptionType) {
    case "1_month":
      return new Date(now.setMonth(now.getMonth() + 1));
    case "3_months":
      return new Date(now.setMonth(now.getMonth() + 3));
    case "6_months":
      return new Date(now.setMonth(now.getMonth() + 6));
    case "12_months":
      return new Date(now.setFullYear(now.getFullYear() + 1));
    default:
      throw new Error("Type d'abonnement invalide");
  }
}

// Endpoint pour vérifier l'utilisateur
app.post("/verify-user", async (req, res) => {
  const { stakeUsername } = req.body;
  console.log(`Requête de vérification pour l'utilisateur: ${stakeUsername}`);

  try {
    const user = await getUser(stakeUsername);

    if (user) {
      const now = new Date();
      const subscriptionEnd = new Date(user.subscription_end);
      const type = user.subscription_type;

      const affiliateNumber = await countValidAffiliates(stakeUsername);

      const subscriptionTypeLabels = {
        "1_month": "1 mois",
        "3_months": "3 mois",
        "6_months": "6 mois",
        "12_months": "12 mois",
        trial: "essai",
      };

      const typeLabel = subscriptionTypeLabels[type] || type;

      if (now <= subscriptionEnd) {
        const response = {
          isValid: true,
          message: `Your ${typeLabel} subscription is valid until ${subscriptionEnd.toLocaleDateString()}.`,
          affiliateNumber: affiliateNumber,
          availableTrial: false,
        };

        if (user.referral_username) {
          response.referralUsername = user.referral_username;
        }

        console.log(`Abonnement valide pour ${stakeUsername}`);
        res.json(response);
      } else {
        const response = {
          isValid: false,
          message: `Your subscription expired on ${subscriptionEnd.toLocaleDateString()}. Please renew it.`,
          needsRenewal: true,
          affiliateNumber: affiliateNumber,
          availableTrial: false,
        };

        if (user.referral_username) {
          response.referralUsername = user.referral_username;
        }

        console.log(`Abonnement expiré pour ${stakeUsername}`);
        res.json(response);
      }
    } else {
      res.json({
        isValid: false,
        message: `Welcome, ${stakeUsername}! Please subscribe to use the application.`,
        needsSubscription: true,
        availableTrial: true,
        affiliateNumber: 0,
      });
      console.log(`Nouvel utilisateur détecté: ${stakeUsername}`);
    }
  } catch (error) {
    console.error("Erreur lors de la vérification de l'utilisateur :", error);
    res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// Endpoint pour appliquer un code promo
app.post("/apply-promo", async (req, res) => {
  const { promoCode, subscriptionType } = req.body;

  console.log(
    `Requête d'application du code promo: ${promoCode} pour l'abonnement: ${subscriptionType}`
  );

  try {
    const promoResult = await verifyPromoCode(promoCode, subscriptionType);
    if (promoResult.isValid) {
      const currentPrices = { ...baseAmounts };
      currentPrices[subscriptionType] *= 1 - promoResult.discount;

      console.log(
        `Code promo appliqué avec succès: ${promoCode}, remise: ${promoResult.discount}`
      );

      res.json({
        success: true,
        updatedPrices: currentPrices,
        appliedTo: subscriptionType,
      });
    } else {
      console.log(
        `Échec de l'application du code promo: ${promoCode}, raison: ${promoResult.message}`
      );
      res.json({ success: false, message: promoResult.message });
    }
  } catch (error) {
    console.error("Erreur lors de la vérification du code promo :", error);
    res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de la vérification du code promo.",
    });
  }
});

function calculateAffiliateDiscount(affiliateNumber) {
  let discount = 0;

  // Affiliés de 1 à 9 : 5% par affilié
  if (affiliateNumber >= 1) {
    const affiliatesInTier = Math.min(affiliateNumber, 9);
    discount += affiliatesInTier * 5;
  }

  // Affiliés de 10 à 29 : 10% par affilié
  if (affiliateNumber >= 10) {
    const affiliatesInTier = Math.min(affiliateNumber, 29) - 9;
    discount += affiliatesInTier * 10;
  }

  return discount;
}

// Endpoint pour créer une invoice Cryptomus
app.post("/create-invoice", async (req, res) => {
  const {
    stakeUsername,
    subscriptionType,
    currency,
    promoCode,
    referralUsername,
  } = req.body;

  console.log(
    `Requête de création d'invoice pour l'utilisateur: ${stakeUsername}, abonnement: ${subscriptionType}`
  );

  try {
    let amount = baseAmounts[subscriptionType];

    // Réduction affiliés
    let affiliateNumber = await countValidAffiliates(stakeUsername);
    const discountFromAffiliates = calculateAffiliateDiscount(affiliateNumber);

    let totalDiscount = 0;
    if (promoCode) {
      const promoResult = await verifyPromoCode(promoCode, subscriptionType);
      if (promoResult.isValid) {
        totalDiscount += promoResult.discount * 100;
        await usePromoCode(promoCode);
      } else {
        console.log(
          `Échec de la vérification du code promo: ${promoCode}, raison: ${promoResult.message}`
        );
        return res.json({ success: false, message: promoResult.message });
      }
    }

    totalDiscount += discountFromAffiliates;

    console.log(
      `Réductions appliquées: Code Promo: ${
        promoCode || "Aucun"
      }, Affiliés: ${discountFromAffiliates}%, Total: ${totalDiscount}%`
    );

    if (totalDiscount >= 90) {
      // Abonnement gratuit
      const subscriptionEnd = calculateSubscriptionEnd(subscriptionType);

      console.log(
        `Réduction totale >= 90%, mise à jour de l'abonnement pour ${stakeUsername}`
      );

      const user = await getUser(stakeUsername);

      if (user) {
        await updateUserSubscription(
          stakeUsername,
          subscriptionType,
          subscriptionEnd,
          referralUsername
        );
      } else {
        await addUser(
          stakeUsername,
          subscriptionType,
          new Date(),
          subscriptionEnd,
          referralUsername
        );
      }

      return res.json({
        success: true,
        message:
          "Félicitations ! Vous avez obtenu un mois d'abonnement gratuit grâce à vos affiliés.",
      });
    } else {
      amount *= 1 - totalDiscount / 100;
      amount = parseFloat(amount.toFixed(2));

      const orderNumber = `${stakeUsername}-${Date.now()}`;
      const callbackUrl = `https://${BACKEND_URL}/cryptomus-callback`;

      const requestBody = {
        amount: amount.toString(),
        currency: "USD",
        order_id: orderNumber,
        url_callback: callbackUrl,
      };

      const sign = crypto
        .createHash("md5")
        .update(
          Buffer.from(JSON.stringify(requestBody)).toString("base64") +
            CRYPTOMUS_API_KEY
        )
        .digest("hex");

      console.log(`Génération du sign pour Cryptomus: ${sign}`);

      const response = await fetch("https://api.cryptomus.com/v1/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          merchant: CRYPTOMUS_MERCHANT_ID,
          sign: sign,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      console.log("Réponse de Cryptomus:", data);

      if (data.state === 0) {
        const invoiceData = data.result;

        await createInvoice(
          invoiceData.uuid,
          orderNumber,
          stakeUsername,
          subscriptionType,
          amount,
          currency,
          "pending",
          promoCode,
          referralUsername
        );

        res.json({
          success: true,
          invoiceUrl: invoiceData.url,
        });
      } else {
        if (promoCode) {
          await revertPromoCode(promoCode);
        }
        console.log(
          `Échec de la création de l'invoice Cryptomus pour ${stakeUsername}`
        );
        res.json({
          success: false,
          message: "Échec de la création de l'invoice Cryptomus.",
        });
      }
    }
  } catch (error) {
    console.error("Erreur lors de la création de l'invoice :", error);
    if (error.data) {
      console.error("Response data:", error.data);
      res.status(500).json({
        message: "Erreur interne du serveur.",
        error: error.data,
      });
    } else {
      res.status(500).json({ message: "Erreur interne du serveur." });
    }
  }
});

// Endpoint callback Cryptomus
app.post("/cryptomus-callback", async (req, res) => {
  const sign = req.body.sign;
  console.log(`Requête de callback reçue avec le sign: ${sign}`);

  if (!sign) {
    console.error("Sign manquant dans le callback");
    return res.status(400).json({ message: "Sign manquant" });
  }

  const rawBody = req.rawBody;
  let data;
  try {
    data = JSON.parse(rawBody);
    console.log("Données du callback parseées avec succès");
  } catch (parseError) {
    console.error(
      "Erreur lors du parsing du corps de la requête :",
      parseError
    );
    return res.status(400).json({ message: "Corps de la requête invalide" });
  }

  delete data.sign;

  const calculatedSign = crypto
    .createHash("md5")
    .update(
      Buffer.from(JSON.stringify(data)).toString("base64") + CRYPTOMUS_API_KEY
    )
    .digest("hex");

  console.log(`Sign calculé: ${calculatedSign}, Sign reçu: ${sign}`);

  if (sign !== calculatedSign) {
    console.error("Sign invalide dans le callback");
    return res.status(400).json({ message: "Sign invalide" });
  }

  const { uuid, order_id, status } = data;
  console.log(
    `Traitement du callback pour order_id: ${order_id}, status: ${status}`
  );

  try {
    await updateInvoiceStatus(order_id, status, uuid);

    if (status === "paid" || status === "paid_over") {
      const invoice = await getInvoice(order_id);

      if (invoice) {
        const stakeUsername = invoice.stake_username;
        const subscriptionEnd = calculateSubscriptionEnd(
          invoice.subscription_type
        );

        const referralUsername = invoice.referralUsername;

        const user = await getUser(stakeUsername);

        if (user) {
          await updateUserSubscription(
            stakeUsername,
            invoice.subscription_type,
            subscriptionEnd,
            referralUsername
          );
          console.log(
            `Abonnement mis à jour pour l'utilisateur ${stakeUsername}`
          );
        } else {
          await addUser(
            stakeUsername,
            invoice.subscription_type,
            new Date(),
            subscriptionEnd,
            referralUsername
          );
          console.log(`Nouvel utilisateur ajouté: ${stakeUsername}`);
        }

        res.status(200).send("OK");
      } else {
        console.error(`Invoice non trouvée pour order_id: ${order_id}`);
        res.status(404).send("Invoice non trouvée");
      }
    } else if (
      status === "expired" ||
      status === "failed" ||
      status === "canceled" ||
      status === "rejected"
    ) {
      console.log(`Statut du paiement : ${status} pour order_id: ${order_id}`);
      const invoice = await getInvoice(order_id);
      if (invoice && invoice.promoCode) {
        await revertPromoCode(invoice.promoCode);
      }
      res.status(200).send(`Statut du paiement : ${status}`);
    } else if (status === "confirm_check") {
      console.log(
        `Paiement en attente de confirmation pour order_id: ${order_id}`
      );
      res.status(200).send(`Statut du paiement : ${status}`);
    } else {
      console.log(
        `Statut du paiement non géré : ${status} pour order_id: ${order_id}`
      );
      res.status(200).send(`Statut du paiement : ${status}`);
    }
  } catch (error) {
    console.error("Erreur lors du traitement du callback :", error);
    res.status(500).send("Erreur interne du serveur");
  }
});

// Endpoint pour obtenir les prix ajustés
app.post("/get-adjusted-prices", async (req, res) => {
  const { stakeUsername, subscriptionType, promoCode } = req.body;

  console.log(
    `Requête de prix ajustés pour l'utilisateur: ${stakeUsername}, abonnement: ${subscriptionType}, code promo: ${promoCode}`
  );

  try {
    const affiliateNumber = await countValidAffiliates(stakeUsername);
    const discountFromAffiliates = calculateAffiliateDiscount(affiliateNumber);

    let totalDiscount = 0;
    if (promoCode) {
      const promoResult = await verifyPromoCode(promoCode, subscriptionType);
      if (promoResult.isValid) {
        totalDiscount += promoResult.discount * 100;
      } else {
        console.log(
          `Échec de la vérification du code promo: ${promoCode}, raison: ${promoResult.message}`
        );
        return res.json({ success: false, message: promoResult.message });
      }
    }

    totalDiscount += discountFromAffiliates;

    console.log(
      `Réductions calculées: Code Promo: ${
        promoCode || "Aucun"
      }, Affiliés: ${discountFromAffiliates}%, Total: ${totalDiscount}%`
    );

    const adjustedPrices = {};
    for (const [type, baseAmount] of Object.entries(baseAmounts)) {
      let price = baseAmount * (1 - totalDiscount / 100);
      price = Math.max(price, 0);
      adjustedPrices[type] = parseFloat(price.toFixed(2));
    }

    res.json({
      success: true,
      adjustedPrices,
      affiliateNumber,
    });

    console.log(`Prix ajustés renvoyés pour ${stakeUsername}`);
  } catch (error) {
    console.error("Erreur lors du calcul des prix ajustés :", error);
    res
      .status(500)
      .json({ success: false, message: "Erreur interne du serveur." });
  }
});

// Endpoint pour demander une période d'essai
app.post("/request-trial", async (req, res) => {
  const { stakeUsername } = req.body;
  console.log(
    `Requête de période d'essai pour l'utilisateur: ${stakeUsername}`
  );

  try {
    const user = await getUser(stakeUsername);

    if (user) {
      res.json({
        success: false,
        message:
          "La période d'essai n'est disponible que pour les nouveaux utilisateurs.",
      });
      console.log(
        `Période d'essai refusée pour ${stakeUsername}, utilisateur existant`
      );
    } else {
      const subscriptionStart = new Date();
      const subscriptionEnd = new Date(subscriptionStart);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 2); // 2 jours d'essai

      await addUser(
        stakeUsername,
        "trial",
        subscriptionStart,
        subscriptionEnd,
        null
      );

      res.json({
        success: true,
        message:
          "Période d'essai activée. Vous pouvez maintenant utiliser l'application pendant 2 jours.",
      });
      console.log(`Période d'essai activée pour ${stakeUsername}`);
    }
  } catch (error) {
    console.error("Erreur lors de la demande d'essai :", error);
    res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// Démarrage du serveur
app.listen(PORT, async () => {
  console.log(
    `Le serveur backend est en cours d'exécution sur le port ${PORT}`
  );
});

process.on("SIGINT", async () => {
  console.log("Arrêt du serveur...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Arrêt du serveur...");
  await prisma.$disconnect();
  process.exit(0);
});
