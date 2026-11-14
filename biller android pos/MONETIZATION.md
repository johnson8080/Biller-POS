# 💰 Monetization Setup Guide

Your File Converter app now has **Google AdMob** and **In-App Purchases** built in. Here's how to activate them.

---

## 📊 What's Included

| Feature | Implementation | Revenue |
|---------|-----------------|---------|
| **Google AdMob** | Banner + Interstitial ads | $0.50–$5 per 1K impressions |
| **In-App Purchases** | Premium subscription ($2.99) | 70% revenue share |
| **Conversion Limits** | Free: 3/day, Premium: unlimited | Drives upgrades |
| **Settings Panel** | Usage stats, version display | User engagement |

---

## 🚀 Step 1: Set Up Google AdMob

### 1.1 Create AdMob Account
1. Go to **https://admob.google.com**
2. Sign in with your Google Account
3. Create a new app entry
4. Choose **Android** as platform
5. Fill in app details:
   - **App name:** File Converter
   - **App category:** Tools
   - **Store URL:** Leave blank (or use Play Store link later)

### 1.2 Create Ad Units
For each ad placement, create an **Ad Unit** and get its ID:

#### Banner Ad (bottom of screen after conversion)
1. **Ad units** → **+New ad unit**
2. **Format:** Banner
3. **Name:** `file_converter_banner`
4. **Ad unit ID:** `ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy` ← Copy this

#### Interstitial Ad (between conversions)
1. **Ad units** → **+New ad unit**
2. **Format:** Interstitial
3. **Name:** `file_converter_interstitial`
4. **Ad unit ID:** `ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy` ← Copy this

### 1.3 Add Ad Unit IDs to Your App

Edit `www/js/monetization.js`:

```javascript
this.adMobUnitId = {
  banner: 'ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy',        // Replace with your banner ID
  interstitial: 'ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy',  // Replace with your interstitial ID
};
```

---

## 📦 Step 2: Add AdMob Plugin to Android

### 2.1 Install AdMob Capacitor Plugin
```bash
cd file-converter
npm install capacitor-admob
npx cap sync
```

### 2.2 Update Android Manifest

Edit `android/app/src/AndroidManifest.xml`:

Add these permissions:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

Add Google Mobile Ads application ID inside `<application>` tag:
```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-xxxxxxxxxxxxxxxx~zzzzzzzzzz" />
```

Get this ID from your AdMob account: **Settings** → **App settings** → **App ID**

### 2.3 Add GoogleMobileAds Dependency

Edit `android/app/build.gradle`:

In `dependencies` section, add:
```gradle
implementation 'com.google.android.gms:play-services-ads:22.6.0'
```

Then sync Gradle.

---

## 🛒 Step 3: Set Up In-App Purchases (Google Play Billing)

### 3.1 Create Product on Google Play Console

1. Go to **https://play.google.com/console**
2. Create a new app (or use existing)
3. **Monetize** → **Products** → **Create product**
4. **Product ID:** `file_converter_premium`
5. **Type:** One-time purchase
6. **Price:** $2.99
7. **Description:** Unlimited conversions + no ads

### 3.2 Install In-App Purchase Plugin

```bash
npm install @capacitor-community/in-app-purchase
npx cap sync
```

### 3.3 Update Monetization Module

Edit `www/js/monetization.js` and uncomment the purchase handler:

Find this section:
```javascript
/**
 * Handle in-app purchase
 */
async purchasePremium() {
  console.log('Initiating purchase flow...');

  // In real app with native plugin:
  // const { InAppPurchase } = Capacitor.Plugins;
  // try {
  //   const result = await InAppPurchase.purchase({
  //     productId: 'file_converter_premium',
  //   });
  //   ...
}
```

Uncomment the plugin code (remove `//`).

---

## 🧪 Step 4: Test on Android Device

### 4.1 Build and Test
```bash
npx cap sync
npx cap open android
```

In Android Studio:
1. **Run** → **Run 'app'**
2. Wait for app to install on device/emulator

### 4.2 Test Ad Display
- Complete a conversion (should see banner ad at bottom)
- Do 3 conversions (should see limit notice)

### 4.3 Test Purchases (Android Emulator Only)
On emulator with Google Play installed:
1. Click settings gear
2. Tap "Upgrade to Premium"
3. Tap "Purchase Premium"
4. Complete test purchase flow

**Note:** Real purchases require signed APK uploaded to Google Play.

---

## 💵 Revenue Models

### Model 1: Ads + Free Tier (Current)
```
Free Users:
├─ 3 conversions/day
├─ See banner ads after conversion
├─ See interstitial ads between conversions
└─ Can upgrade to remove ads

Premium Users:
├─ Unlimited conversions
├─ No ads
└─ Priority support (future)
```

**Expected Revenue (1,000 DAU):**
- Ads: ~$10–50/month
- Purchases: ~$100–500/month (10% conversion)
- **Total: $110–550/month**

### Model 2: Premium Only (No Free Tier)
```
All Users:
└─ $2.99 one-time purchase
```

**Expected Revenue:**
- 5% conversion = $15/month (1,000 DAU)
- 10% conversion = $30/month (1,000 DAU)
- **Total: $15–30/month**

### Model 3: Freemium + Ads + Subscription
```
Free Users:
├─ 3 conversions/day
├─ Ads everywhere

Premium Monthly:
├─ Unlimited conversions
├─ No ads
└─ Recurring: $0.99/month

Premium Lifetime:
└─ $4.99 one-time
```

**Choose this if targeting volume.**

---

## 📈 Optimization Tips

### Increase Conversion Rate to Premium
1. **Show value:** Display conversion count prominently
2. **Timing:** Show upgrade prompt after 3rd conversion
3. **Pricing:** $2.99 is sweet spot (not too low, not too high)
4. **Benefits:** Emphasize "no ads" + "unlimited"

### Increase Ad Revenue
1. **Placement:** Banner at bottom (non-intrusive)
2. **Timing:** Show ads after successful conversion (user is happy)
3. **Frequency:** Don't spam (one ad per action)
4. **Fill rate:** Higher fill rate in US/UK/CA

### Growth Hacks
- Share referral links (future feature)
- Show "help 3 friends" to get 1 free premium day
- Seasonal promotions ($0.99 for 1 month)
- Push notifications for ad-hoc campaigns

---

## 📊 Monitoring Earnings

### Google AdMob Dashboard
- **Estimated Earnings:** Updated daily
- **Impressions & CTR:** Track ad performance
- **Geographic breakdown:** See where revenue comes from

### Google Play Console
- **Earnings Report:** Revenue by country
- **Sales analysis:** Conversion rates by device
- **Refund tracking:** Monitor refund rates

### Set Up Firebase Analytics (Optional)
Track custom events:
```javascript
// Track conversion
firebase.analytics().logEvent('conversion_completed', {
  from_format: 'docx',
  to_format: 'pdf',
  file_size: 2400000,
});

// Track premium purchase
firebase.analytics().logEvent('premium_purchased', {
  price: 2.99,
  currency: 'USD',
});
```

---

## 🚀 Launch Checklist

- [ ] Add AdMob Account
- [ ] Create 2 Ad Units (banner + interstitial)
- [ ] Copy Ad Unit IDs to `monetization.js`
- [ ] Add AdMob plugin to Android
- [ ] Update AndroidManifest.xml with AdMob ID
- [ ] Create Google Play Console account
- [ ] Create product for in-app purchase
- [ ] Uncomment purchase code in `monetization.js`
- [ ] Test on Android device
- [ ] Build release APK
- [ ] Upload to Google Play Store
- [ ] Enable ads in AdMob console
- [ ] Monitor earnings

---

## 💡 Pro Tips

### Testing Ads
Use **Test Ad Unit IDs** from AdMob while developing:
- **Banner:** `ca-app-pub-3940256099942544/6300978111`
- **Interstitial:** `ca-app-pub-3940256099942544/1033173712`

Replace with real IDs before launch.

### Avoid Policy Violations
- Don't incentivize watching ads ("watch ad to get 1 conversion")
- Don't show ads on app startup
- Don't show multiple ads at once
- Don't place ads over buttons/controls
- Don't mislead about free/paid

### Maximize LTV (Lifetime Value)
```
LTV = (Purchase Price × Conversion Rate) + (Monthly Ad Revenue × Lifetime in Months)

Example:
LTV = ($2.99 × 0.10) + ($1 × 12) = $0.30 + $12 = $12.30 per user
```

---

## 📞 Troubleshooting

| Problem | Solution |
|---------|----------|
| Ads not showing | Check AdMob approval (takes 24-48 hours) |
| Purchase button disabled | Verify product created on Play Console |
| AdMob ID showing errors | Double-check ID format in code |
| No revenue after launch | Ensure `android.permission.INTERNET` is set |
| Test ads show but real don't | Make sure you uploaded to Play Store |

---

## Next Steps

1. **Set up AdMob:** 15 minutes
2. **Add Ad Unit IDs:** 5 minutes
3. **Configure Google Play:** 20 minutes
4. **Test on device:** 10 minutes
5. **Build & launch:** 30 minutes

**Total: ~1.5 hours from start to live earnings!**

---

**Questions?** Check Google's official guides:
- AdMob Setup: https://support.google.com/admob
- Play Billing: https://developer.android.com/google/play/billing
