# Google Sign-In Setup for Coach Hub

Coach Hub supports Google sign-in through Supabase Auth.

## 1. Google Cloud / Google Auth Platform

Create an OAuth 2.0 Client ID with application type **Web application**.

Use:

- **Authorized JavaScript origin:** `https://allynd.github.io`
- **Authorized redirect URI:** `https://ajsqnyimcqemaznsivzn.supabase.co/auth/v1/callback`

Save the generated Google **Client ID** and **Client Secret**.

## 2. Supabase

In the Supabase dashboard open **Authentication → Providers → Google**.

Enable Google and paste the Google Client ID and Client Secret.

Then open **Authentication → URL Configuration** and ensure these are allowed:

- Site URL: `https://allynd.github.io/vb-coach-hub/`
- Redirect URL: `https://allynd.github.io/vb-coach-hub/`

## 3. Coach Hub

After the v13 deployment is live, open Coach Hub and choose **Team → Cloud & Accounts → Continue with Google**.

Google authentication creates/signs into the Coach Hub Supabase account. Existing local team data remains on the device until the coach deliberately uploads it to the cloud.
