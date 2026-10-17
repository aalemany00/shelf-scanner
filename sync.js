// Phone <-> laptop sync via Firestore. This is a single-user app (just
// Adrian, on his own devices), so there's one shared "items" collection
// rather than per-user scoping — anonymous auth just proves "this is a
// client of our app," not "this is a specific person." See the Firestore
// security rule note in LOG.md for the tradeoff this implies.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const itemsCol = collection(db, "items");

var listeners = [];
var latestItems = null;

function notify() {
  listeners.forEach(function (fn) { fn(latestItems); });
}

onSnapshot(
  itemsCol,
  function (snap) {
    latestItems = snap.docs.map(function (d) { return d.data(); });
    notify();
  },
  function (err) {
    console.error("Firestore sync error", err);
    window.dispatchEvent(new CustomEvent("shelfsync:error", { detail: err }));
  }
);

var authReady = new Promise(function (resolve) {
  onAuthStateChanged(auth, function (user) {
    if (user) resolve(user);
  });
});
signInAnonymously(auth).catch(function (err) {
  console.error("Firebase anonymous sign-in failed", err);
  window.dispatchEvent(new CustomEvent("shelfsync:error", { detail: err }));
});

window.ShelfSync = {
  authReady: authReady,
  subscribe: function (fn) {
    listeners.push(fn);
    if (latestItems) fn(latestItems);
  },
  setItem: function (item) {
    return setDoc(doc(itemsCol, item.id), item);
  },
  deleteItem: function (id) {
    return deleteDoc(doc(itemsCol, id));
  }
};

window.dispatchEvent(new Event("shelfsync:loaded"));
