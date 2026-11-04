-- CreateIndex
CREATE UNIQUE INDEX "sites_clientId_domain_key" ON "sites"("clientId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "sites_clientId_url_key" ON "sites"("clientId", "url");
