-- AlterTable
ALTER TABLE "AlertConfig" ADD COLUMN "createdAtDt" DATETIME;
ALTER TABLE "AlertConfig" ADD COLUMN "targetPriceDec" DECIMAL;
ALTER TABLE "AlertConfig" ADD COLUMN "triggerPriceDec" DECIMAL;

-- AlterTable
ALTER TABLE "BacktestResult" ADD COLUMN "endDateDt" DATETIME;
ALTER TABLE "BacktestResult" ADD COLUMN "finalCapitalDec" DECIMAL;
ALTER TABLE "BacktestResult" ADD COLUMN "initialCapitalDec" DECIMAL;
ALTER TABLE "BacktestResult" ADD COLUMN "startDateDt" DATETIME;
ALTER TABLE "BacktestResult" ADD COLUMN "totalReturnDec" DECIMAL;

-- AlterTable
ALTER TABLE "ConversionTransaction" ADD COLUMN "fromAmountDec" DECIMAL;
ALTER TABLE "ConversionTransaction" ADD COLUMN "rateDec" DECIMAL;
ALTER TABLE "ConversionTransaction" ADD COLUMN "timestampDt" DATETIME;
ALTER TABLE "ConversionTransaction" ADD COLUMN "toAmountDec" DECIMAL;

-- AlterTable
ALTER TABLE "LedgerTransaction" ADD COLUMN "feePaidUsdDec" DECIMAL;
ALTER TABLE "LedgerTransaction" ADD COLUMN "priceDec" DECIMAL;
ALTER TABLE "LedgerTransaction" ADD COLUMN "quantityDec" DECIMAL;
ALTER TABLE "LedgerTransaction" ADD COLUMN "timestampDt" DATETIME;
ALTER TABLE "LedgerTransaction" ADD COLUMN "totalAmountDec" DECIMAL;

-- AlterTable
ALTER TABLE "PortfolioHolding" ADD COLUMN "purchasePriceDec" DECIMAL;
ALTER TABLE "PortfolioHolding" ADD COLUMN "quantityDec" DECIMAL;

