// server.js

// Importations nécessaires
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { MongoClient, ServerApiVersion } = require("mongodb");
const crypto = require("crypto");

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

// Middleware pour CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Remplacez '*' par l'URL de votre frontend en production
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Middleware bodyParser pour parser les données JSON
app.use(bodyParser.json());

// Configuration des clés API et autres informations sensibles
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;
const MONGODB_URI = process.env.MONGO_URL;
const BACKEND_URL = process.env.BACKEND_URL;
const PORT = process.env.PORT || 3000;

// Montants de base pour les abonnements
const baseAmounts = {
  "1_month": 19.99,
  "3_months": 49.99,
  "6_months": 79.99,
  "12_months": 139.99,
};

// Classe DatabaseManager pour gérer la base de données
class DatabaseManager {
  constructor() {
    this.client = new MongoClient(MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      // Options de pool de connexions pour optimiser les performances
      maxPoolSize: 10, // Remplacez poolSize par maxPoolSize
    });
    this.dbName = "SSP";
    this.isConnected = false;
  }

  async connect() {
    if (!this.isConnected) {
      try {
        await this.client.connect();
        this.isConnected = true;
        console.log("Connecté à MongoDB");
        this.db = this.client.db(this.dbName);
        this.users = this.db.collection("users");
        this.invoices = this.db.collection("invoices");
        this.promos = this.db.collection("promos");
      } catch (error) {
        console.error("Échec de la connexion à MongoDB", error);
        throw error;
      }
    }
  }

  // Ajout de logs détaillés pour chaque méthode
  async addUser(
    stakeUsername,
    subscriptionType,
    subscriptionStart,
    subscriptionEnd,
    referralUsername
  ) {
    await this.connect();
    console.log(`Ajout de l'utilisateur: ${stakeUsername}`);
    try {
      const result = await this.users.insertOne({
        stake_username: stakeUsername,
        subscription_type: subscriptionType,
        subscription_start: new Date(subscriptionStart),
        subscription_end: new Date(subscriptionEnd),
        referral_username: referralUsername,
      });
      console.log(`Utilisateur ajouté avec l'ID: ${result.insertedId}`);
      return result.insertedId;
    } catch (error) {
      console.error(`Erreur lors de l'ajout de l'utilisateur ${stakeUsername}:`, error);
      throw error;
    }
  }

  async getUser(stakeUsername) {
    await this.connect();
    console.log(`Recherche de l'utilisateur: ${stakeUsername}`);
    try {
      const user = await this.users.findOne({
        stake_username: { $regex: new RegExp(`^${stakeUsername}$`, "i") },
      });
      console.log(`Utilisateur ${stakeUsername} ${user ? "trouvé" : "non trouvé"}`);
      return user;
    } catch (error) {
      console.error(`Erreur lors de la récupération de l'utilisateur ${stakeUsername}:`, error);
      throw error;
    }
  }

  async countValidAffiliates(referralUsername) {
    await this.connect();
    console.log(`Comptage des affiliés valides pour: ${referralUsername}`);
    try {
      const now = new Date();
      const count = await this.users.countDocuments({
        referral_username: { $regex: new RegExp(`^${referralUsername}$`, "i") },
        subscription_end: { $gte: now },
      });
      console.log(`Nombre d'affiliés valides pour ${referralUsername}: ${count}`);
      return count;
    } catch (error) {
      console.error(`Erreur lors du comptage des affiliés pour ${referralUsername}:`, error);
      throw error;
    }
  }

  async updateUserSubscription(stakeUsername, subscriptionType, subscriptionEnd, referralUsername) {
  await this.connect();
  console.log(`Mise à jour de l'abonnement pour: ${stakeUsername}`);
  try {
    const updateFields = {
      subscription_type: subscriptionType,
      subscription_end: new Date(subscriptionEnd),
    };

    const user = await this.getUser(stakeUsername);

    if (!user.referral_username && referralUsername) {
      updateFields.referral_username = referralUsername;
    }

    const result = await this.users.updateOne(
      { stake_username: { $regex: new RegExp(`^${stakeUsername}$`, "i") } },
      { $set: updateFields }
    );

    console.log(`Abonnement mis à jour pour ${stakeUsername}, documents modifiés: ${result.modifiedCount}`);
    return result.modifiedCount;
  } catch (error) {
    console.error(`Erreur lors de la mise à jour de l'abonnement pour ${stakeUsername}:`, error);
    throw error;
  }
}


  async createInvoice(
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
    await this.connect();
    console.log(`Création de l'invoice pour l'utilisateur: ${stakeUsername}, Order Number: ${orderNumber}`);
    try {
      const result = await this.invoices.insertOne({
        txn_id: txnId,
        order_number: orderNumber,
        stake_username: stakeUsername,
        subscription_type: subscriptionType,
        amount: amount,
        currency: currency,
        status: status,
        promoCode: promoCode,
        referralUsername: referralUsername,
        created_at: new Date(),
      });
      console.log(`Invoice créée avec l'ID: ${result.insertedId}`);
      return result.insertedId;
    } catch (error) {
      console.error(`Erreur lors de la création de l'invoice pour ${stakeUsername}:`, error);
      throw error;
    }
  }

  async updateInvoiceStatus(orderNumber, status, txnId) {
    await this.connect();
    console.log(`Mise à jour du statut de l'invoice: ${orderNumber} à ${status}`);
    try {
      const result = await this.invoices.updateOne(
        { order_number: orderNumber },
        {
          $set: {
            status: status,
            txn_id: txnId,
            updated_at: new Date(),
          },
        }
      );
      console.log(`Statut de l'invoice ${orderNumber} mis à jour, documents modifiés: ${result.modifiedCount}`);
      return result.modifiedCount;
    } catch (error) {
      console.error(`Erreur lors de la mise à jour du statut de l'invoice ${orderNumber}:`, error);
      throw error;
    }
  }

  async getInvoice(orderNumber) {
    await this.connect();
    console.log(`Récupération de l'invoice pour l'Order Number: ${orderNumber}`);
    try {
      const invoice = await this.invoices.findOne({ order_number: orderNumber });
      console.log(`Invoice ${orderNumber} ${invoice ? "trouvée" : "non trouvée"}`);
      return invoice;
    } catch (error) {
      console.error(`Erreur lors de la récupération de l'invoice ${orderNumber}:`, error);
      throw error;
    }
  }

  async verifyPromoCode(promoCode, subscriptionType) {
    await this.connect();
    console.log(`Vérification du code promo: ${promoCode} pour l'abonnement: ${subscriptionType}`);
    try {
      const promo = await this.promos.findOne({ code: promoCode });

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

      // Vérifier si le code promo s'applique au type d'abonnement sélectionné
      if (!promo.applicableDurations.includes(subscriptionType)) {
        console.log(`Code promo non applicable pour le type d'abonnement: ${subscriptionType}`);
        return {
          isValid: false,
          message:
            "Ce code promo n'est pas applicable pour la durée d'abonnement sélectionnée.",
        };
      }

      console.log(`Code promo valide: ${promoCode}, remise: ${promo.discount}`);
      return { isValid: true, discount: promo.discount };
    } catch (error) {
      console.error(`Erreur lors de la vérification du code promo ${promoCode}:`, error);
      throw error;
    }
  }

  async usePromoCode(promoCode) {
    await this.connect();
    console.log(`Utilisation du code promo: ${promoCode}`);
    try {
      const result = await this.promos.updateOne(
        { code: promoCode },
        { $inc: { usageLimit: -1 } }
      );
      const success = result.modifiedCount === 1;
      console.log(`Code promo ${promoCode} utilisé: ${success}`);
      return success;
    } catch (error) {
      console.error(`Erreur lors de l'utilisation du code promo ${promoCode}:`, error);
      throw error;
    }
  }

  async revertPromoCode(promoCode) {
    await this.connect();
    console.log(`Réinitialisation du code promo: ${promoCode}`);
    try {
      const result = await this.promos.updateOne(
        { code: promoCode },
        { $inc: { usageLimit: 1 } }
      );
      const success = result.modifiedCount === 1;
      console.log(`Code promo ${promoCode} réinitialisé: ${success}`);
      return success;
    } catch (error) {
      console.error(`Erreur lors de la réinitialisation du code promo ${promoCode}:`, error);
      throw error;
    }
  }

  async close() {
    if (this.isConnected) {
      await this.client.close();
      this.isConnected = false;
      console.log("Connexion à MongoDB fermée");
    }
  }
}

// Instancier le DatabaseManager
const Database = new DatabaseManager();

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
    const user = await Database.getUser(stakeUsername);

    if (user) {
      const now = new Date();
      const subscriptionEnd = new Date(user.subscription_end);
      const type = user.subscription_type;

      const affiliateNumber = await Database.countValidAffiliates(
        stakeUsername
      );

      const subscriptionTypeLabels = {
        "1_month": "1 mois",
        "3_months": "3 mois",
        "6_months": "6 mois",
        "12_months": "12 mois",
      };

      const typeLabel = subscriptionTypeLabels[type] || type;

      if (now <= subscriptionEnd) {
        // Préparer la réponse
        const response = {
          isValid: true,
          message: `Your ${typeLabel} subscription is valid until ${subscriptionEnd.toLocaleDateString()}.`,
          affiliateNumber: affiliateNumber,
          availableTrial: false,
        };

        // Inclure referralUsername s'il existe
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

  console.log(`Requête d'application du code promo: ${promoCode} pour l'abonnement: ${subscriptionType}`);

  try {
    const promoResult = await Database.verifyPromoCode(
      promoCode,
      subscriptionType
    );
    if (promoResult.isValid) {
      const currentPrices = { ...baseAmounts };
      currentPrices[subscriptionType] *= 1 - promoResult.discount;

      console.log(`Code promo appliqué avec succès: ${promoCode}, remise: ${promoResult.discount}`);

      res.json({
        success: true,
        updatedPrices: currentPrices,
        appliedTo: subscriptionType,
      });
    } else {
      console.log(`Échec de l'application du code promo: ${promoCode}, raison: ${promoResult.message}`);
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

  console.log(`Requête de création d'invoice pour l'utilisateur: ${stakeUsername}, abonnement: ${subscriptionType}`);

  try {
    let amount = baseAmounts[subscriptionType];

    // Appliquer la réduction basée sur les affiliés
    let affiliateNumber = await Database.countValidAffiliates(stakeUsername);
    const discountFromAffiliates = calculateAffiliateDiscount(affiliateNumber);

    // Appliquer la réduction du code promo s'il y en a un
    let totalDiscount = 0;
    if (promoCode) {
      const promoResult = await Database.verifyPromoCode(
        promoCode,
        subscriptionType
      );
      if (promoResult.isValid) {
        totalDiscount += promoResult.discount * 100; // Convertir en pourcentage
        await Database.usePromoCode(promoCode);
      } else {
        console.log(`Échec de la vérification du code promo: ${promoCode}, raison: ${promoResult.message}`);
        return res.json({ success: false, message: promoResult.message });
      }
    }

    // Ajouter la réduction des affiliés
    totalDiscount += discountFromAffiliates;

    console.log(`Réductions appliquées: Code Promo: ${promoCode || "Aucun"}, Affiliés: ${discountFromAffiliates}%, Total: ${totalDiscount}%`);

    // Vérifier si la réduction totale atteint ou dépasse 90%
    if (totalDiscount >= 90) {
      // Ajouter un mois d'abonnement à l'utilisateur sans créer d'invoice
      const subscriptionEnd = calculateSubscriptionEnd(subscriptionType);

      console.log(`Réduction totale >= 90%, mise à jour de l'abonnement pour ${stakeUsername}`);

      const user = await Database.getUser(stakeUsername);

      if (user) {
        // Mettre à jour l'abonnement de l'utilisateur
        await Database.updateUserSubscription(
          stakeUsername,
          subscriptionType,
          subscriptionEnd,
          referralUsername
        );
      } else {
        // Ajouter un nouvel utilisateur
        await Database.addUser(
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
      // Calculer le montant après réduction
      amount *= 1 - totalDiscount / 100;
      amount = parseFloat(amount.toFixed(2)); // Arrondir à deux décimales

      const orderNumber = `${stakeUsername}-${Date.now()}`;

      // URL de callback pour Cryptomus (doit être accessible publiquement)
      const callbackUrl = `https://${BACKEND_URL}/cryptomus-callback`;

      // Préparer le corps de la requête
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

        // Enregistrer l'invoice dans la base de données
        await Database.createInvoice(
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
          await Database.revertPromoCode(promoCode);
        }
        console.log(`Échec de la création de l'invoice Cryptomus pour ${stakeUsername}`);
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

// Endpoint pour le callback de Cryptomus
app.post("/cryptomus-callback", async (req, res) => {
  const sign = req.body.sign;

  console.log(`Requête de callback reçue avec le sign: ${sign}`);

  if (!sign) {
    console.error("Sign manquant dans le callback");
    return res.status(400).json({ message: "Sign manquant" });
  }

  // Obtenir le corps brut de la requête
  const rawBody = req.rawBody;

  // Parser le JSON brut
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

  // Supprimer le sign des données pour le calcul
  delete data.sign;

  // Calculer le sign
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

  // Continuer avec le traitement du webhook
  const { uuid, order_id, status } = data;

  console.log(
    `Traitement du callback pour order_id: ${order_id}, status: ${status}`
  );

  try {
    // Mettre à jour le statut de l'invoice dans la base de données
    const updateResult = await Database.updateInvoiceStatus(
      order_id,
      status,
      uuid
    );
    console.log(
      `Statut de l'invoice mis à jour pour order_id: ${order_id}, résultat: ${updateResult}`
    );

    if (status === "paid" || status === "paid_over") {
      // Traiter les paiements réussis, y compris les paiements en excès
      const invoice = await Database.getInvoice(order_id);

      if (invoice) {
        const stakeUsername = invoice.stake_username;
        const subscriptionEnd = calculateSubscriptionEnd(
          invoice.subscription_type
        );

        const referralUsername = invoice.referralUsername;

        const user = await Database.getUser(stakeUsername);

        if (user) {
          // Mettre à jour l'abonnement de l'utilisateur
          const updateCount = await Database.updateUserSubscription(
            stakeUsername,
            invoice.subscription_type,
            subscriptionEnd,
            referralUsername
          );
          console.log(
            `Abonnement mis à jour pour l'utilisateur ${stakeUsername}, nombre de documents modifiés: ${updateCount}`
          );
        } else {
          // Ajouter un nouvel utilisateur
          const insertedId = await Database.addUser(
            stakeUsername,
            invoice.subscription_type,
            new Date(),
            subscriptionEnd,
            referralUsername
          );
          console.log(
            `Nouvel utilisateur ajouté: ${stakeUsername}, ID inséré: ${insertedId}`
          );
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
      // Traiter les paiements échoués ou annulés
      console.log(`Statut du paiement : ${status} pour order_id: ${order_id}`);

      // Remettre à jour le code promo si le paiement n'est pas complété
      const invoice = await Database.getInvoice(order_id);
      if (invoice && invoice.promoCode) {
        const revertResult = await Database.revertPromoCode(invoice.promoCode);
        console.log(
          `Code promo réinitialisé : ${invoice.promoCode}, résultat: ${revertResult}`
        );
      }
      res.status(200).send(`Statut du paiement : ${status}`);
    } else if (status === "confirm_check") {
      // Le paiement est en attente de confirmation
      console.log(
        `Paiement en attente de confirmation pour order_id: ${order_id}`
      );
      // Vous pouvez décider de ne rien faire ou de mettre à jour l'invoice
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

  console.log(`Requête de prix ajustés pour l'utilisateur: ${stakeUsername}, abonnement: ${subscriptionType}, code promo: ${promoCode}`);

  try {
    // Récupérer le nombre d'affiliés valides
    const affiliateNumber = await Database.countValidAffiliates(stakeUsername);

    // Calculer la réduction basée sur les affiliés
    const discountFromAffiliates = calculateAffiliateDiscount(affiliateNumber);

    // Appliquer la réduction du code promo s'il y en a un
    let totalDiscount = 0;
    if (promoCode) {
      const promoResult = await Database.verifyPromoCode(
        promoCode,
        subscriptionType
      );
      if (promoResult.isValid) {
        totalDiscount += promoResult.discount * 100; // Convertir en pourcentage
      } else {
        console.log(`Échec de la vérification du code promo: ${promoCode}, raison: ${promoResult.message}`);
        return res.json({ success: false, message: promoResult.message });
      }
    }

    // Ajouter la réduction des affiliés
    totalDiscount += discountFromAffiliates;

    console.log(`Réductions calculées: Code Promo: ${promoCode || "Aucun"}, Affiliés: ${discountFromAffiliates}%, Total: ${totalDiscount}%`);

    // Calculer les prix ajustés pour chaque type d'abonnement
    const adjustedPrices = {};
    for (const [type, baseAmount] of Object.entries(baseAmounts)) {
      let price = baseAmount * (1 - totalDiscount / 100);
      // S'assurer que le prix n'est pas négatif
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

  console.log(`Requête de période d'essai pour l'utilisateur: ${stakeUsername}`);

  try {
    const user = await Database.getUser(stakeUsername);

    if (user) {
      // L'utilisateur existe déjà, ne pas accorder l'essai
      res.json({
        success: false,
        message:
          "La période d'essai n'est disponible que pour les nouveaux utilisateurs.",
      });
      console.log(`Période d'essai refusée pour ${stakeUsername}, utilisateur existant`);
    } else {
      // Créer un nouvel utilisateur avec un abonnement d'essai
      const subscriptionStart = new Date();
      const subscriptionEnd = new Date(subscriptionStart);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 2); // Ajouter 2 jours

      await Database.addUser(
        stakeUsername,
        "trial",
        subscriptionStart,
        subscriptionEnd,
        null // Pas de referralUsername pour les essais
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
  // Assurez-vous que la connexion à la base de données est établie
  try {
    await Database.connect();
    console.log(
      `Le serveur backend est en cours d'exécution sur le port ${PORT}`
    );
  } catch (error) {
    console.error("Erreur lors de la connexion à la base de données :", error);
    process.exit(1); // Arrêter le serveur si la connexion échoue
  }
});

// Gestion de la fermeture propre de l'application
process.on("SIGINT", async () => {
  console.log("Arrêt du serveur...");
  await Database.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Arrêt du serveur...");
  await Database.close();
  process.exit(0);
});
