import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { setAuthTokenGetter } from "./custom-fetch";

const firebaseConfig = {
  apiKey: "AIzaSyBEcTVV6oleE-3YFKwGZQcBwRPAJIPBz8o",
  authDomain: "cafeverun.firebaseapp.com",
  databaseURL:
    "https://cafeverun-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cafeverun",
  storageBucket: "cafeverun.firebasestorage.app",
  messagingSenderId: "149659003784",
  appId: "1:149659003784:web:fcdba31bbe200cb5f2a83d",
  measurementId: "G-9NS8FJBC9M",
};

const firebaseApp = getApps().some((app) => app.name === "cafe-verun")
  ? getApp("cafe-verun")
  : initializeApp(firebaseConfig, "cafe-verun");

export const firebaseAuth = getAuth(firebaseApp);

setAuthTokenGetter(
  () => firebaseAuth.currentUser?.getIdToken() ?? null,
);

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(firebaseAuth, provider);
}

export function googleSignInErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/operation-not-allowed") {
    return "Google ile giriş Firebase Console'da etkin değil.";
  }
  if (code === "auth/unauthorized-domain") {
    return "Bu site alan adı Firebase Auth'ta yetkilendirilmemiş.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "Bu e-posta başka bir giriş yöntemiyle kayıtlı. Mevcut yönteminizle giriş yapın.";
  }
  if (code === "auth/popup-blocked") {
    return "Tarayıcı giriş penceresini engelledi. Açılır pencerelere izin verip tekrar deneyin.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google giriş penceresi kapatıldı. Tekrar deneyebilirsiniz.";
  }
  if (code === "auth/network-request-failed") {
    return "Bağlantı kurulamadı. İnternetinizi kontrol edip yeniden deneyin.";
  }
  return "Google ile giriş yapılamadı. Biraz sonra tekrar deneyin.";
}

export {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
};
export type { User as FirebaseUser };
