# SAM build target for ApiFunction
# Compiles TypeScript, generates Prisma client, bundles node_modules for Lambda
build-ApiFunction:
	npm ci --omit=dev
	DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
	npx tsc
	cp -r dist/* $(ARTIFACT_DIR)/
	cp package.json $(ARTIFACT_DIR)/
	cp -r node_modules $(ARTIFACT_DIR)/
	cp -r prisma $(ARTIFACT_DIR)/
