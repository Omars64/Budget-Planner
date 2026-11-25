# Budgetly UI baseline

The current shipped Budgetly UI is the approved design for mobile and desktop. Preserve its layout, navigation, component placement, and styling when adding features. Make layout or visual changes only when the user explicitly requests them.

Treat gamification as an optional feature layer within the existing UI. The Budgetly Progress gamification POC was exploratory and the user explicitly declined implementation. Implement it only if the user explicitly changes that decision.

For a new Budgetly release, bump the app version and Android version code, sync the version files, run build-Budgetly.bat on main, and verify that the published GitHub release contains both the Android APK and Windows installer.
