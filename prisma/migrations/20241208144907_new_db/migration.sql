-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "stake_username" TEXT NOT NULL,
    "subscription_type" TEXT NOT NULL,
    "subscription_start" TIMESTAMP(3) NOT NULL,
    "subscription_end" TIMESTAMP(3) NOT NULL,
    "referral_username" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "txn_id" TEXT,
    "order_number" TEXT NOT NULL,
    "stake_username" TEXT NOT NULL,
    "subscription_type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promoCode" TEXT,
    "referralUsername" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "usageLimit" INTEGER NOT NULL,
    "applicableDurations" TEXT[],

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_stake_username_key" ON "User"("stake_username");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_order_number_key" ON "Invoice"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "Promo_code_key" ON "Promo"("code");
