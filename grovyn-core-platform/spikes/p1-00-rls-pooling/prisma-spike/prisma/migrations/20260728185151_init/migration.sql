-- CreateTable
CREATE TABLE "rls_test" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payload" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rls_test_pkey" PRIMARY KEY ("id")
);
