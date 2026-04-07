import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? undefined,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? undefined,
};

const missingConfig = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId],
].filter(([, value]) => !value).map(([key]) => key);

export function getFirebaseConfigError(): string | null {
  if (missingConfig.length === 0) {
    return null;
  }

  return `Configure as variaveis Firebase no .env.local: ${missingConfig.join(", ")}`;
}

function getFirebaseApp() {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  if (getApps().length > 0) {
    return getApp();
  }

  return initializeApp(firebaseConfig);
}

let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;
let firestoreInstance: Firestore | null = null;

export function getFirebaseAuthClient(): Auth {
  if (authInstance) {
    return authInstance;
  }

  authInstance = getAuth(getFirebaseApp());
  return authInstance;
}

export function getGoogleAuthProvider(): GoogleAuthProvider {
  if (googleProviderInstance) {
    return googleProviderInstance;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  googleProviderInstance = provider;
  return provider;
}

export function getFirebaseFirestore(): Firestore {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  firestoreInstance = getFirestore(getFirebaseApp());
  return firestoreInstance;
}

/** Login Google vindo do app Mac (ASWebAuthenticationSession + PKCE), fora do WKWebView. */
export async function signInWithGoogleNativeIdToken(
  idToken: string,
  accessToken?: string | null
): Promise<void> {
  const auth = getFirebaseAuthClient();
  const credential = GoogleAuthProvider.credential(
    idToken,
    accessToken && accessToken.length > 0 ? accessToken : undefined
  );
  await signInWithCredential(auth, credential);
}
