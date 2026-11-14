# Cloud storage (Firebase) — setup

Biller POS works with no connection: everything is kept on the device in
`localStorage`. When you sign in, the same shop is mirrored to **Cloud
Firestore** so the till can be opened on another device, and each signed-in
account leaves a small **presence** record so the developer can see who is
online.

The app talks to these two Firestore collections:

| Collection         | Document       | What it holds                                    |
| ------------------ | -------------- | ------------------------------------------------ |
| `billerShops`     | your user id   | the whole shop state (products, orders, settings) |
| `billerPresence`  | your user id   | your email, app version, last seen, online flag  |

---

## 1. Turn on Firestore for this project

The Firebase project used by the app is **`biller-91aaf`**.

Fastest way — open this link directly:

<https://console.firebase.google.com/project/biller-91aaf/firestore/databases>

If you would rather walk the menu, the left-hand rail of the Firebase console
has **Databases & Storage → Firestore** (older versions of the console call it
**Build → Firestore Database**). You can also type **Firestore** into the
search box at the top of the console.

Then:

1. Click **Add database**
2. Edition **Standard** → **Next**
3. **Database ID** — leave it empty and the database is created as
   `(default)`, which is the one the app connects to
4. Pick a **location** (any one is fine) → **Next**
5. For the starting mode pick **Production mode** — the rules below are what
   open it up for your account
6. **Create**

Firestore is currently switched **off** for this project, so until it is
created the app stays in local mode and says so on the Account screen.

## 2. Paste the security rules

The rules live in [`firestore.rules`](firestore.rules) in this folder, so they
can be reviewed and deployed from the command line.

On the Firestore page, open the **Rules** tab → paste this → **Publish**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // --- Helpers -------------------------------------------------------
    function signedIn() { return request.auth != null; }
    function email() { return request.auth.token.email != null ? request.auth.token.email.lower() : ''; }
    // The developer: the only account that may read the list of accounts.
    function isOwner() { return email() == 'johnsonommala1@gmail.com'; }

    // --- The shop -------------------------------------------------------
    // One document per account. The shop follows the account, not the
    // device: sign in on another phone and the same shop comes with you.
    match /billerShops/{uid} {
      allow read: if signedIn() && request.auth.uid == uid;
      allow create, update, delete: if signedIn() && request.auth.uid == uid;
    }

    // --- Presence -------------------------------------------------------
    // Each account writes only its own record (email, app version, last
    // seen, online flag). Only the developer may read the whole list.
    match /billerPresence/{uid} {
      allow read: if signedIn() && isOwner();
      allow create, update, delete: if signedIn() && request.auth.uid == uid;
    }
  }
}
```

Press **Publish**.

To deploy the same file from the command line instead:

```bash
cd "biller pc pos"
firebase deploy --only firestore:rules --project biller-91aaf
```

> The presence rule is what keeps the account list private: only the
> developer account can read the other accounts. Add more emails to
> `isOwner()` if you want a second person to see it.

## 3. Turn on the developer tools

The developer panel (signed-in accounts and who is online) shows only when:

- the signed-in email is `johnsonommala1@gmail.com`, **or**
- the signed-in account owns the Firebase project (`isOwner()` in the rules).

The panel is never shown to a shop account. The email list lives in
`js/core.js` (`DEV_EMAILS`), and the plan lock exempts the same account.

## 4. What happens on the device

| Action                        | What the app does                                          |
| ----------------------------- | ---------------------------------------------------------- |
| Any change to the shop        | saved on the device at once, pushed to Firestore ~1s later |
| Signing in                    | pulls the cloud copy down, then keeps watching presence    |
| Sync now (Account screen)     | fetches the cloud copy by hand                            |
| **Account → Cloud backup**    | shows the storage state and a **Sync now** button          |
| Signing out                   | marks the presence record as offline                       |

If Firebase is unreachable the app keeps selling and shows
*“Could not reach the cloud — saved on this device”*.

---

## Presence collection (optional)

You can watch the accounts live in the Firebase console:
**Firestore → Data → `billerPresence`**. Each signed-in account writes a
record with its email, app version and a timestamp; `off: true` means the
account signed out.
