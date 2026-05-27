import { auth, googleProvider, onAuthStateChanged, signInWithPopup, signOut } from "./firebase-config.js";

let currentUser = null;
let authReady = false;
let authErrorMessage = "";
const subscribers = new Set();
const errorSubscribers = new Set();

function emitAuthState() {
  const snapshot = {
    ready: authReady,
    user: currentUser,
    errorMessage: authErrorMessage,
  };

  for (const subscriber of subscribers) {
    subscriber(snapshot);
  }
}

function emitAuthError(errorMessage) {
  authErrorMessage = errorMessage;

  for (const subscriber of errorSubscribers) {
    subscriber(authErrorMessage);
  }

  emitAuthState();
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authReady = true;
  authErrorMessage = "";
  emitAuthState();
});

function getAuthState() {
  return {
    ready: authReady,
    user: currentUser,
  };
}

function subscribeAuthState(subscriber) {
  subscribers.add(subscriber);
  subscriber(getAuthState());

  return () => {
    subscribers.delete(subscriber);
  };
}

function subscribeAuthError(subscriber) {
  errorSubscribers.add(subscriber);
  subscriber(authErrorMessage);

  return () => {
    errorSubscribers.delete(subscriber);
  };
}

function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider).catch((error) => {
    if (error?.code === "auth/api-key-not-valid.-please-pass-a-valid-api-key.") {
      const message =
        location.protocol === "file:"
          ? "Firebase Auth is being opened from file://. Serve the app over http://localhost and retry."
          : "Firebase rejected the API key. Check that this config belongs to the current Firebase project and that the key is not restricted by origin in Google Cloud.";
      emitAuthError(message);
    }

    throw error;
  });
}

function signOutUser() {
  return signOut(auth);
}

export { getAuthState, signInWithGoogle, signOutUser, subscribeAuthError, subscribeAuthState };