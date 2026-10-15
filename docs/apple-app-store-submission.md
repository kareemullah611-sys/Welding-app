# MRF Hardware — Apple Submission Dossier

## Permanent Identity

- App name: `MRF Hardware`
- Bundle ID: `com.mrf.hardware`
- Background task ID: `com.mrf.hardware.offline.sync`
- Category: Business
- Minimum iOS/iPadOS version: 14.0
- Encryption declaration: standard platform HTTPS only; no non-exempt encryption is implemented by the app

Do not change the bundle ID after creating the App Store Connect record.

## Recommended Distribution

Use **Private — Custom App through Apple Business Manager** when the app is only for MRF Hardware personnel. Use an
unlisted App Store app only if authorized users cannot be managed through Apple Business Manager. Confirm the final
distribution method before approval because Apple does not permit changing a private custom app to public after approval.

## App Review Notes

MRF Hardware is an authenticated business ERP for authorized company personnel. It manages inventory, lots, sales,
payments, expenses, treasury, liabilities, accounting reports, and controlled offline synchronization. It has no public
registration, advertising, in-app purchases, cryptocurrency, lending, or interest-bearing functionality.

The app uses the organization&apos;s own enterprise credentials, so Sign in with Apple is not applicable. Accounts are
created and managed by an authorized superadmin. A city administrator can deactivate their own account through
`Settings → Delete Account`; organization-owner account requests are handled by the designated administrator. The app
queues approved create operations while offline and retries them idempotently when connectivity returns. iOS decides
when scheduled background processing runs; opening the app also starts synchronization.

### Reviewer access — owner must complete

- Review environment URL: `[REQUIRED]`
- Superadmin demo username: `[REQUIRED]`
- Superadmin demo password: `[REQUIRED]`
- City-admin demo username: `[REQUIRED]`
- City-admin demo password: `[REQUIRED]`
- Device approval instructions or pre-approved reviewer device policy: `[REQUIRED]`
- Contact name, phone, and email available during review: `[REQUIRED]`

Use isolated demonstration data. Never provide production credentials or customer records.

## App Privacy Answers

The native privacy manifest declares the following as linked to the user, used only for app functionality, and not used
for tracking:

- Name
- User ID
- Device ID
- Other financial information
- Other user content

App Store Connect answers must remain consistent with `ios/App/App/PrivacyInfo.xcprivacy` and the deployed privacy policy.
The app does not display advertising and does not perform cross-app tracking.

## Submission URLs — owner must complete

- Privacy URL: `https://welding-app-production.up.railway.app/privacy`
- Support URL: `https://welding-app-production.up.railway.app/support`
- Marketing URL: optional
- Legal business name and address: `[REQUIRED]`
- Public support email or telephone: `[REQUIRED before submission]`

Verify both URLs without authentication immediately before submission.

## Required Screenshots

Capture real-device screenshots using isolated demonstration data for every submitted display size. At minimum show:

1. Login
2. Dashboard
3. Inventory or lots
4. Sale entry
5. Customer ledger
6. Financial report or trial balance
7. Offline queue/synchronization state

Do not include real customer names, bank details, phone numbers, documents, credentials, or production balances.

## Release Gate

1. Run `npm run test:apple-readiness`.
2. Run `npm run package:ios:sync`.
3. Confirm `out/uploads` and `ios/App/App/public/uploads` do not exist.
4. Run the full application test suite and production build.
5. Build the `App` scheme in Xcode without signing for simulator validation.
6. Test login, offline launch, supported offline writes, foreground synchronization, background synchronization, conflict
   handling, logout, privacy page, and support page on a physical iPhone and iPad.
7. Create an archive with the account owner&apos;s Apple Distribution certificate and provisioning profile.
8. Validate the archive in Xcode Organizer and review the generated privacy report.
9. Upload to TestFlight and complete internal acceptance before App Review.

## External Owner Dependencies

Code cannot complete Apple Developer enrollment, business verification, agreements, tax/banking setup, certificate and
profile creation, App Store Connect metadata, Apple Business Manager organization assignment, real-device testing, or
the final submission. These remain release-owner responsibilities.
