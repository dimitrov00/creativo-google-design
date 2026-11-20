# Changelog

## 0.1.0 (2026-11-20)


### Features

* **functions:** run the backend in europe-west8 (Milan) beside the database, for clients in Bulgaria ([#107](https://github.com/dimitrov00/creativo-google-design/issues/107)) ([c963ae5](https://github.com/dimitrov00/creativo-google-design/commit/c963ae5aca76417e9b7fb6a329c29a9d64ed99e9))
* **ops:** shop-location.mjs writes a new project's shop document, held to the preflight's own check ([#113](https://github.com/dimitrov00/creativo-google-design/issues/113)) ([07afd2f](https://github.com/dimitrov00/creativo-google-design/commit/07afd2fdeea26f9aca9246ca47ed73ae274cc2a3))
* **team:** «Моят профил» in the menu — a linked barber's way back to their own page once the welcome and the setup card have gone ([#102](https://github.com/dimitrov00/creativo-google-design/issues/102)) ([909beb1](https://github.com/dimitrov00/creativo-google-design/commit/909beb1c44d0520a2e5f84db9d995d08d68af466))


### Bug Fixes

* **a11y:** controls are named by the words they print, and axe-core moves to 4.14 ([#125](https://github.com/dimitrov00/creativo-google-design/issues/125)) ([616829e](https://github.com/dimitrov00/creativo-google-design/commit/616829e0a35e1268e895985190a5c59bcf9ed24a))
* **deploy:** deploy-identity.sh creates the Pub/Sub service agent before it binds it ([#111](https://github.com/dimitrov00/creativo-google-design/issues/111)) ([7de93e3](https://github.com/dimitrov00/creativo-google-design/commit/7de93e3ddb8ed8fcce39a8adc294a37ad7cd8556))
* **deploy:** every callable answers the public after the functions deploy, and no other function does ([#130](https://github.com/dimitrov00/creativo-google-design/issues/130)) ([3ef1800](https://github.com/dimitrov00/creativo-google-design/commit/3ef1800d8c069499676ce08735bd8e94331976d4))
* **deploy:** the deploy account may act as the App Engine default account, which firebase-tools checks ([#118](https://github.com/dimitrov00/creativo-google-design/issues/118)) ([e21cad3](https://github.com/dimitrov00/creativo-google-design/commit/e21cad3944038bbb4965ff37216585eea5b25689))
* **deploy:** the deploy account may read the Storage bucket's metadata, so the rules deploy finds it ([#117](https://github.com/dimitrov00/creativo-google-design/issues/117)) ([75f342d](https://github.com/dimitrov00/creativo-google-design/commit/75f342dca4466439c83ecbba57f267846a2aafba))
* **deploy:** the deploy account reads the default Storage bucket, and the first deploy's stop is in the checklist ([#116](https://github.com/dimitrov00/creativo-google-design/issues/116)) ([8a139ef](https://github.com/dimitrov00/creativo-google-design/commit/8a139ef47d0635dc71fad94544f806e7f8133fa9))
* **deploy:** the deploy account trusts repository id + environment, not the job's subject ([#115](https://github.com/dimitrov00/creativo-google-design/issues/115)) ([b079137](https://github.com/dimitrov00/creativo-google-design/commit/b0791374a7b9a2552cc1e275241cf0e4a368730f))
* **deploy:** the deploy identity script makes the functions' own runtime account, ahead of the switch that moves them onto it ([#128](https://github.com/dimitrov00/creativo-google-design/issues/128)) ([09ae4b9](https://github.com/dimitrov00/creativo-google-design/commit/09ae4b913be09a36dd451ee412263f8cb5c6c97a))
* **deploy:** the deploy identity turns the Cloud Billing API on, which every functions deploy reads ([#120](https://github.com/dimitrov00/creativo-google-design/issues/120)) ([53ef4f2](https://github.com/dimitrov00/creativo-google-design/commit/53ef4f2c5baaa62cec1e2c923ffae14afe2a3950))
* **deploy:** the functions deploy is forced, since firebase-tools refuses a retrying trigger without it ([#119](https://github.com/dimitrov00/creativo-google-design/issues/119)) ([0f15944](https://github.com/dimitrov00/creativo-google-design/commit/0f15944b2570f4bbef97eacd3e8549aaef19c525))
* **functions:** the deployed package declares the Functions Framework, which Cloud Build's pnpm install requires ([#121](https://github.com/dimitrov00/creativo-google-design/issues/121)) ([e4cedde](https://github.com/dimitrov00/creativo-google-design/commit/e4ceddec2aaa7bc430efc50ccc5b2c03b5db79b3))
* **landing:** the landing draws the stored catalogue, never authored barbers, ratings or shops ([#127](https://github.com/dimitrov00/creativo-google-design/issues/127)) ([02926fc](https://github.com/dimitrov00/creativo-google-design/commit/02926fc53f622445a37c1f25cd440dbe9b59d981))
* **release:** leave the changelog to release-please — no placeholder, never reformatted ([#114](https://github.com/dimitrov00/creativo-google-design/issues/114)) ([f3a9722](https://github.com/dimitrov00/creativo-google-design/commit/f3a9722f8ebd13b149a0c6bb38b0587d0f62fa62))
