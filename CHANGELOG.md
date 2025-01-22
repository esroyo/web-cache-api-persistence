# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.7](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.6...v0.1.7) (2025-01-22)


### Bug Fixes

* normalize Vary contents to lower case ([67fa217](https://github.com/esroyo/web-cache-api-persistence/commit/67fa217de54e5d3d1150a58577bcc0c6bac45f2e))

## [0.1.6](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.5...v0.1.6) (2024-12-17)


### Other

* add minimal info to README ([dd9ba07](https://github.com/esroyo/web-cache-api-persistence/commit/dd9ba071f75d8410a13442083f0a9dd45fc2b9c2))

## [0.1.5](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.4...v0.1.5) (2024-11-27)


### Bug Fixes

* revert no-cache honoring ([1ed97ac](https://github.com/esroyo/web-cache-api-persistence/commit/1ed97ac02a4ddfd3a4a3fed6d2757988487ebda2))

## [0.1.4](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.3...v0.1.4) (2024-11-27)


### Features

* honor request no-cache ([414c59a](https://github.com/esroyo/web-cache-api-persistence/commit/414c59ab2d59a15dac6d3271c42314f1823f5740))

## [0.1.3](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.2...v0.1.3) (2024-11-26)


### Features

* add "consistency" option on Kv persistence ([350c910](https://github.com/esroyo/web-cache-api-persistence/commit/350c910cca1fb5d78fd11f98fe129c175101b790))

## [0.1.2](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.1...v0.1.2) (2024-11-21)


### Features

* implement Cache delete/put as batched operations ([5775d47](https://github.com/esroyo/web-cache-api-persistence/commit/5775d474ff943a3aa1eb9b4a86b30f5418bd591d))


### Bug Fixes

* trim Vary field values ([6abe715](https://github.com/esroyo/web-cache-api-persistence/commit/6abe7155a0dc74be92250c30bd8667708e26a166))


### Other

* simplify plain req/res ([c8078f0](https://github.com/esroyo/web-cache-api-persistence/commit/c8078f04d8e304017a444a5fa4f4322c48e3c941))

## [0.1.1](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.0...v0.1.1) (2024-11-19)

## 0.1.0 (2024-11-19)


### Features

* complete W3C spec ([f8a039c](https://github.com/esroyo/web-cache-api-persistence/commit/f8a039cf4bd44b3156b66bbdd939bbfdea4db391))
* first commit ([6bcf116](https://github.com/esroyo/web-cache-api-persistence/commit/6bcf11619ac59ef34e7ad0ef10b7926040482dd0))


### Bug Fixes

* better W3C standard support (older response order, and update response) ([4b6108b](https://github.com/esroyo/web-cache-api-persistence/commit/4b6108b5e6ea6468088e73672c547ab949f474f8))
* remove reqBody and make sure no indexes remain upon delete ([63c826f](https://github.com/esroyo/web-cache-api-persistence/commit/63c826f3e6ebc6b02180cd4fd4e972e966fa080e))


### Other

* add CachePersistence type documentation ([2c75fbe](https://github.com/esroyo/web-cache-api-persistence/commit/2c75fbebcb3c061069a0947c5787cd35d26f6e15))
* add full typing for Cache and CacheStorage ([991d734](https://github.com/esroyo/web-cache-api-persistence/commit/991d73488a970345d04e0926e1a90d04b28d022c))
* make compress a common option ([a1efc0e](https://github.com/esroyo/web-cache-api-persistence/commit/a1efc0edc35b1cc1c95c7a23843d23edeafe500c))
* minor corrections ([fec11f2](https://github.com/esroyo/web-cache-api-persistence/commit/fec11f2c335d7a6ae0dfcd120d785990acdc92b7))
* use sendCommand in redis client ([bc2af28](https://github.com/esroyo/web-cache-api-persistence/commit/bc2af28945af001386247479a48c7131c9c2037d))
