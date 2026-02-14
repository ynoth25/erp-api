# SAM build: TypeScript + Prisma (includes node_modules for Lambda)
build-ApiFunction:
	npm ci
	npm run build
	cp -r dist/* $(ARTIFACT_DIR)/
	cp package.json $(ARTIFACT_DIR)/
	cp -r node_modules $(ARTIFACT_DIR)/
