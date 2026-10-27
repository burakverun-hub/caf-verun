import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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
