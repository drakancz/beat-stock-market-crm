-- AlterTable
ALTER TABLE "client_notes" ADD COLUMN     "createdViaMcp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "mcp_keys" ADD COLUMN     "canWrite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "createdViaMcp" BOOLEAN NOT NULL DEFAULT false;
