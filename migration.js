// migration.js
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

const prisma = new PrismaClient();

async function migrateUsers() {
  const usersData = JSON.parse(fs.readFileSync("./users.json"));
  for (const doc of usersData) {
    await prisma.user.create({
      data: {
        stake_username: doc.stake_username,
        subscription_type: doc.subscription_type,
        subscription_start: new Date(doc.subscription_start.$date),
        subscription_end: new Date(doc.subscription_end.$date),
        referral_username: doc.referral_username || null,
      },
    });
  }
  console.log("Users migrated");
}

async function migrateInvoices() {
  const invoicesData = JSON.parse(fs.readFileSync("./invoices.json"));
  for (const doc of invoicesData) {
    const parsedAmount = parseFloat(doc.amount);

    // Adapter le statut si nécessaire (ex : completed -> paid)
    let status = doc.status;
    if (status === "completed") {
      status = "paid";
    }

    await prisma.invoice.create({
      data: {
        txn_id: doc.txn_id,
        order_number: doc.order_number,
        stake_username: doc.stake_username,
        subscription_type: doc.subscription_type,
        amount: parsedAmount,
        currency: doc.currency,
        status: status,
        // si promoCode ou referralUsername n'existaient pas dans Mongo, laisser null
        created_at: new Date(doc.created_at.$date),
        updated_at: doc.updated_at ? new Date(doc.updated_at.$date) : null,
      },
    });
  }
  console.log("Invoices migrated");
}

async function migratePromos() {
  const promosData = JSON.parse(fs.readFileSync("./promos.json"));
  for (const doc of promosData) {
    await prisma.promo.create({
      data: {
        code: doc.code,
        discount: doc.discount,
        expirationDate: new Date(doc.expirationDate.$date),
        usageLimit: doc.usageLimit,
        applicableDurations: doc.applicableDurations,
      },
    });
  }
  console.log("Promos migrated");
}

async function main() {
  await migrateUsers();
  await migrateInvoices();
  await migratePromos();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
