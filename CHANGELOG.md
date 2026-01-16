# [1.1.0](https://github.com/xalsie/kodiak/compare/v1.0.0...v1.1.0) (2026-01-16)


### Bug Fixes

* enhance type safety by adding type annotations for job data in simple.ts ([973c8d6](https://github.com/xalsie/kodiak/commit/973c8d676a42c8b50b7a3bf5e54f2183f1a4654d))
* enhance type safety in RedisQueueRepository and related tests by refining type assertions and removing unnecessary ignores ([5e9eb8f](https://github.com/xalsie/kodiak/commit/5e9eb8ff1991c5a8d69c6bb399eec1eb096e3922))
* heap out of memory ([f02114f](https://github.com/xalsie/kodiak/commit/f02114f156717c215535c0ae718e57ce842f897b))
* update authentication tokens for GitHub Packages in CI/CD and package configuration ([5408f58](https://github.com/xalsie/kodiak/commit/5408f58d63d86eaf6fc81e4b5bab2e4f0489bbc4))
* update failJobUseCase to use job ID instead of job object ([653a005](https://github.com/xalsie/kodiak/commit/653a00520fa445e05047b6c9e4dcf06ab87282da))
* update ioredis and @types/node dependencies to latest versions ([2263803](https://github.com/xalsie/kodiak/commit/226380306c73fb42f5d7445c8b45179480455ce9))
* update README with correct package name and logo URL, enhance type safety in examples ([8827835](https://github.com/xalsie/kodiak/commit/88278355fee8c2bd25774b913f8730cd0c67a9da))


### Features

* add GitHub Actions workflows for npm publishing and configure package settings ([d3dc7fa](https://github.com/xalsie/kodiak/commit/d3dc7fa7cf024def14f214afda69fe17b64c6ea6))
* add job progress tracking and update functionality ([7b3535b](https://github.com/xalsie/kodiak/commit/7b3535b267e950731d19c53be410cd85cd0d8e22))
* add support for recurring jobs with repeat options in job configurations and Lua scripts ([3a8674d](https://github.com/xalsie/kodiak/commit/3a8674d668b77338772b8af42181806d859e724a))
* add unit tests for AddJobUseCase and Queue, enhance RedisQueueRepository tests with timeout handling and backoff options ([139dd77](https://github.com/xalsie/kodiak/commit/139dd7765fef099eee239cd17892f3121d42cb9f))
* add updateProgress functionality to job handling and tests ([27e9e11](https://github.com/xalsie/kodiak/commit/27e9e1127728cff4eed14258e61ab8379d5a9ef0))
* enhance email worker to track and report job progress ([f427d14](https://github.com/xalsie/kodiak/commit/f427d1429123b1b6d36378139a93d898ce1c866e))
* implement automatic job retries with backoff strategy and promote delayed jobs - [#20](https://github.com/xalsie/kodiak/issues/20) ([6f383aa](https://github.com/xalsie/kodiak/commit/6f383aa4f7238325d3264158a4e906c601fcfc75))
* implement custom backoff strategy and recurring jobs - [#23](https://github.com/xalsie/kodiak/issues/23) ([8b1c433](https://github.com/xalsie/kodiak/commit/8b1c433f472877556e8145a7e6c8210aed4272f5))
* implement Fetch Job mechanism - [#3](https://github.com/xalsie/kodiak/issues/3) ([99573cd](https://github.com/xalsie/kodiak/commit/99573cdb5c0c452fb187cd6a316e6f849083d707)), closes [#4](https://github.com/xalsie/kodiak/issues/4) [#5](https://github.com/xalsie/kodiak/issues/5) [#6](https://github.com/xalsie/kodiak/issues/6) [#7](https://github.com/xalsie/kodiak/issues/7) [#8](https://github.com/xalsie/kodiak/issues/8) [#9](https://github.com/xalsie/kodiak/issues/9) [#17](https://github.com/xalsie/kodiak/issues/17) [#18](https://github.com/xalsie/kodiak/issues/18)

# 1.0.0 (2026-01-13)


### Bug Fixes

* trigger initial release ([6a3701f](https://github.com/xalsie/kodiak/commit/6a3701fdb78b9396537d3baf1df805cddde55fb0))
