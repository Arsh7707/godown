# Login codes on WhatsApp

Godown sends the 6-digit login code as a WhatsApp message from your business
number, with a **Copy code** button. Until this is set up, codes are shown on
the login screen (`OTP_DEV_MODE=true`) behind the shared access code.

What it costs: Meta charges per login-code ("authentication") message; check
the current India rate on Meta's pricing page. People stay logged in for 90
days, so codes are rare.

## 1. Meta account and number (once)

1. Create a **Meta Business** account at business.facebook.com (or use the one
   for your Facebook/Instagram page).
2. Go to developers.facebook.com → **My Apps → Create app** → type **Business**
   → add the **WhatsApp** product.
3. **WhatsApp → API Setup** gives a free test number to try things first (it can
   message up to 5 numbers you add as testers).
4. For real use, **add your business phone number** there. It must **not** be
   in use in the normal WhatsApp or WhatsApp Business app (a spare SIM works;
   it only needs to receive one verification SMS or call).
5. In **WhatsApp Manager → Payment settings**, add a payment method.
6. In **Business settings → Security centre**, start **Business verification**
   (GST certificate or similar). Until it's done, Meta limits how many people
   you can message per day; verification can take a few days.

## 2. The message template

WhatsApp Manager → **Message templates → Create template**:

- Category: **Authentication**
- Name: **`login_code`**
- Languages: **English** and **Hindi** (Hindi users get Hindi; if the Hindi one
  isn't approved, they get English)
- Code delivery: **Copy code**
- Tick **Add security recommendation**, and set **expiry: 10 minutes**
  (Godown's codes last 10 minutes)

Meta writes the text itself ("123456 is your verification code…") and
usually approves it within minutes.

## 3. A permanent token

The token on the API Setup page expires in 24 hours. For the real one:

1. **Business settings → Users → System users → Add**, role **Admin**.
2. **Assign assets**: your app and your WhatsApp account, full control.
3. **Generate token** for your app, expiry **Never**, permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy it straight into Vercel (next step). Don't paste it anywhere else.

## 4. Vercel settings (Production only)

Vercel → godown → **Settings → Environment Variables**, tick **only
Production**:

| Name | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | the permanent token from step 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | **Phone number ID** from WhatsApp → API Setup (a long number, not the phone number) |
| `WHATSAPP_OTP_TEMPLATE` | only if your template isn't named `login_code` |

Then switch Production's **`OTP_DEV_MODE`** to `false` (or delete it). With
it off, codes go on WhatsApp and the access code is no longer asked for.
Previews keep `OTP_DEV_MODE=true`, so testing never sends real messages.

Redeploy Production (Deployments → latest → ⋯ → Redeploy) for the settings to
take effect, then log in once with your own number to check.

## If something goes wrong

- **"This number isn't on WhatsApp"**: the person's login number has no
  WhatsApp. Change it in Manage → Team to the number they use WhatsApp on.
- **"Couldn't send the code just now"**: Meta was busy, or the setup needs
  fixing. Vercel → Logs shows `[login] WhatsApp setup problem: …` with Meta's
  reason (an expired token, a template not approved, a payment issue…).
- Going back to codes on screen: set `OTP_DEV_MODE=true` again and redeploy.
