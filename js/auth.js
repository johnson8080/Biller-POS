/* ============================================================
   Biller — login screen (sign in / create account)
   ------------------------------------------------------------
   The welcome screen is the first thing the app shows. It offers
   sign in and account creation on one page, with inline validation,
   and drops the user straight into the sell screen once Firebase
   confirms the credentials.
   ============================================================ */
window.Till = window.Till || {};
window.Till.auth = (() => {
  "use strict";

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MIN_PASSWORD_LENGTH = 8;

  // "signin" | "signup"
  let mode = "signin";

  /* ---------- DOM helpers ---------- */

  const root = () => document.getElementById("login-screen");
  const input = (id) => document.getElementById(id);

  function setFieldError(name, message) {
    const holder = document.querySelector(`[data-error-for="${name}"]`);
    if (holder) holder.textContent = message || "";
    const field = document.querySelector(`[data-field="${name}"]`);
    if (field) field.classList.toggle("has-error", Boolean(message));
  }

  function setAlert(message) {
    const box = input("login-alert");
    const text = input("login-alert-text");
    if (text) text.textContent = message || "";
    if (box) {
      if (message) box.removeAttribute("hidden");
      else box.setAttribute("hidden", "");
    }
  }

  function clearErrors() {
    setFieldError("email", "");
    setFieldError("password", "");
    setFieldError("confirmPassword", "");
    setAlert("");
  }

  function setBusy(busy) {
    const button = input("login-submit");
    if (!button) return;
    button.classList.toggle("is-busy", Boolean(busy));
    button.disabled = Boolean(busy);
    const label = button.querySelector(".login-submit-label");
    if (label) {
      label.textContent = busy
        ? (mode === "signup" ? "Creating account…" : "Signing in…")
        : (mode === "signup" ? "Create account" : "Sign in");
    }
  }

  /* ---------- Errors ---------- */

  /**
   * Firebase auth errors are codes plus developer-facing sentences. Shop
   * staff should never see "auth/invalid-credential", so every code the
   * sign-in flow can produce is translated into something actionable.
   */
  function friendlyError(error) {
    switch (String(error?.code || "")) {
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/missing-email":
        return "Enter your email address.";
      case "auth/missing-password":
        return "Enter your password.";
      case "auth/wrong-password":
        return "That password is not correct. Please try again.";
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
        return "That email or password is not correct.";
      case "auth/user-not-found":
        return "No account found for that email. Check the address, or create an account.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/email-already-in-use":
        return "An account already exists for that email. Try signing in instead.";
      case "auth/weak-password":
        return `Use a stronger password — at least ${MIN_PASSWORD_LENGTH} characters.`;
      case "auth/too-many-requests":
        return "Too many attempts. Wait a moment and try again.";
      case "auth/network-request-failed":
        return "No connection. Check your network and try again.";
      case "auth/operation-not-allowed":
        return "Email sign-in is switched off for this app. Please contact support.";
      case "auth/unauthorized-domain":
        return "This app is not authorised for sign-in here. Please contact support.";
      case "auth/requires-recent-login":
        return "Please sign in again to continue.";
      case "auth/too-many-requests-request":
        return "Too many attempts. Wait a moment and try again.";
      default: {
        const raw = String(error?.message || "").trim();
        const cleaned = raw
          .replace(/^Firebase:\s*/i, "")
          .replace(/\s*\(auth\/[a-z-]+\)\.?$/i, "")
          .trim();
        // Firebase's generic "Error" carries no information for the shop owner.
        if (!cleaned || cleaned.toLowerCase() === "error") {
          return "Something went wrong. Please try again.";
        }
        return cleaned;
      }
    }
  }

  /* ---------- Validation ---------- */

  function validate() {
    const email = (input("login-email")?.value || "").trim();
    const password = input("login-password")?.value || "";
    const confirm = input("login-confirm")?.value || "";
    let ok = true;

    setFieldError("email", "");
    setFieldError("password", "");
    setFieldError("confirmPassword", "");

    if (!email) {
      setFieldError("email", "Enter your email address.");
      ok = false;
    } else if (!EMAIL_PATTERN.test(email)) {
      setFieldError("email", "Enter a valid email address.");
      ok = false;
    }

    if (mode === "signup") {
      if (!password) {
        setFieldError("password", "Choose a password.");
        ok = false;
      } else if (password.length < MIN_PASSWORD_LENGTH) {
        setFieldError("password", `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        ok = false;
      }
      if (confirm !== password) {
        setFieldError("confirmPassword", "Passwords do not match.");
        ok = false;
      }
    } else if (!password) {
      setFieldError("password", "Enter your password.");
      ok = false;
    }

    return ok;
  }

  /* ---------- Mode ---------- */

  /** Put the screen back to its default state — used after a sign-in or sign-out. */
  function reset() {
    mode = "signin";
    setMode("signin");
    clearErrors();
    const email = input("login-email");
    if (email) email.value = "";
    const password = input("login-password");
    if (password) password.value = "";
    const confirm = input("login-confirm");
    if (confirm) confirm.value = "";
  }

  function setMode(next) {
    mode = next === "signup" ? "signup" : "signin";

    const screen = root();
    if (screen) screen.dataset.mode = mode;

    const seg = input("login-seg");
    if (seg) seg.dataset.active = mode;

    document.querySelectorAll(".login-seg-btn").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.loginMode === mode));
    });

    const password = input("login-password");
    if (password) {
      password.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
    }

    const label = document.querySelector(".login-submit-label");
    if (label) {
      label.textContent = mode === "signup" ? "Create account" : "Sign in";
    }

    clearErrors();
  }

  /* ---------- Submit ---------- */

  async function submit() {
    if (!validate()) return;

    const email = (input("login-email")?.value || "").trim();
    const password = input("login-password")?.value || "";

    setAlert("");
    setBusy(true);

    try {
      if (!window.firebaseAuth) {
        throw { code: "auth/network-request-failed" };
      }
      let user = null;
      if (mode === "signup") {
        user = await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
      } else {
        user = await window.firebaseAuth.signInWithEmailAndPassword(email, password);
      }
      // Firebase has accepted the credentials. The auth observer in app.js
      // also stores the session, but navigating here means the app opens
      // straight away even if the observer is slow.
      // The compat SDK hands back a UserCredential, so the user itself
      // lives on .user - without this the shop would fall back to the
      // local one and the account would look empty.
      const authUser = user?.user || user || null;
      window.Till.setSession(email, authUser?.uid || "");
      window.Till.activateAccount?.(authUser || { email, uid: "" });
      reset();
      if (typeof window.Till?.goHome === "function") {
        window.Till.goHome();
      } else {
        history.replaceState(null, "", "#/sell");
        if (typeof window.render === "function") window.render();
      }
    } catch (error) {
      console.warn("Auth error:", error);
      const code = String(error?.code || "");
      setAlert(friendlyError(error));
      if (code === "auth/email-already-in-use") setMode("signin");
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Wiring ---------- */

  function attach() {
    const screen = root();
    if (!screen) return;

    screen.dataset.mode = mode;
    const seg = input("login-seg");
    if (seg) seg.dataset.active = mode;

    document.querySelectorAll(".login-seg-btn").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.loginMode === mode));
    });

    screen.querySelectorAll("[data-login-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.loginMode));
    });

    screen.querySelectorAll("[data-login-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = input(btn.dataset.loginToggle);
        if (!target) return;
        const showing = target.type === "text";
        target.type = showing ? "password" : "text";
        btn.setAttribute("aria-pressed", String(!showing));
        btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
        const use = btn.querySelector("use");
        if (use) use.setAttribute("href", showing ? "#i-eye" : "#i-eye-off");
      });
    });

    const form = input("login-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit();
      });
    }

    // Clear a field's error as soon as the user starts correcting it.
    screen.querySelectorAll(".login-field input").forEach((field) => {
      field.addEventListener("input", () => {
        const key = field.dataset.inputFor;
        if (key) setFieldError(key, "");
        setAlert("");
      });
    });
  }

  return {
    attach,
    setMode,
    reset,
    submit,
    friendlyError,
    get mode() { return mode; }
  };
})();
