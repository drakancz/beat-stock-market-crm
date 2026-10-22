-- CreateTable
CREATE TABLE "custom_rules" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_rule_runs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "refKey" VARCHAR(64) NOT NULL,
    "detail" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_rule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_rule_runs_clientId_createdAt_idx" ON "custom_rule_runs"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_rule_runs_ruleId_clientId_refKey_key" ON "custom_rule_runs"("ruleId", "clientId", "refKey");

-- AddForeignKey
ALTER TABLE "custom_rule_runs" ADD CONSTRAINT "custom_rule_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "custom_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_rule_runs" ADD CONSTRAINT "custom_rule_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
