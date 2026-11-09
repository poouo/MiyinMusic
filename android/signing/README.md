# MiYin development signing

`miyin-debug.p12` is an intentionally public development certificate for the debug APK distributed by this repository. Alias and passwords: `androiddebugkey` / `android`.

Keep this exact file across CI runs. Do not regenerate it when updating the app. Production release keys must remain private and separate from this debug certificate.
