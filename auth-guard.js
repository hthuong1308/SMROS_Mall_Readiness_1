// auth-guard.js
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { auth } from "./firebase-init.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    const returnUrl = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.href = `AUTH.html?returnUrl=${returnUrl}`;
  }
});
