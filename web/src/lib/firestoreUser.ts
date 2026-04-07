import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseFirestore } from "@/lib/firebaseClient";

/** Documento em `users/{uid}` — espelha o utilizador do Firebase Auth e metadados da app. */
export type FirestoreUserDocument = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  /** Primeiro registo na coleção (só definido na criação). */
  createdAt?: ReturnType<typeof serverTimestamp>;
  /** Última atualização do perfil / login. */
  updatedAt: ReturnType<typeof serverTimestamp>;
};

const USERS_COLLECTION = "users";

function logFirestoreRegistrationError(error: unknown): void {
  const anyErr = error as { code?: string; message?: string };
  const code = anyErr?.code ?? "unknown";
  const message = anyErr?.message ?? String(error);

  console.error("[Brain2 Firestore users]", code, message);

  if (code === "permission-denied") {
    console.error(
      "[Brain2] Firestore recusou escrita. No Firebase Console → Firestore → Regras, permita que utilizadores autenticados escrevam em users/{userId}. Veja firestore.rules na pasta web."
    );
  }
  if (code === "failed-precondition" || message.includes("Firestore API")) {
    console.error(
      "[Brain2] Confirme se a base Firestore foi criada: Firebase Console → Firestore Database → Criar base de dados."
    );
  }
}

/**
 * Garante que existe `users/{uid}` no Firestore após login.
 * Cria o documento na primeira vez; depois faz merge e atualiza campos de perfil.
 */
export async function registerOrUpdateUserInFirestore(user: User): Promise<void> {
  await user.getIdToken(true);

  const db = getFirebaseFirestore();
  const ref = doc(db, USERS_COLLECTION, user.uid);
  const snap = await getDoc(ref);

  const payload: Record<string, unknown> = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(ref, payload, { merge: true });
}

export { logFirestoreRegistrationError };
