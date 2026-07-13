import { database, ref, set, onValue, push, remove } from "./firebase-config.js";
import { subscribeAuthState } from "./auth.js";

export class SkillSync {
	constructor(callbacks = {}) {
		this.nodesRef = null;
		this.connectionsRef = null;
		this.regionsRef = null;
		this.nodesUnsubscribe = null;
		this.connectionsUnsubscribe = null;
		this.regionsUnsubscribe = null;
		this.currentUserId = null;
		this.currentAuthUser = null;
		this.callbacks = {
			onNodesUpdate: callbacks.onNodesUpdate ?? (() => {}),
			onConnectionsUpdate: callbacks.onConnectionsUpdate ?? (() => {}),
			onRegionsUpdate: callbacks.onRegionsUpdate ?? (() => {}),
			onAuthStateChange: callbacks.onAuthStateChange ?? (() => {}),
		};
	}

	init() {
		subscribeAuthState((state) => {
			if (!state.ready) {
				return;
			}

			if (!state.user) {
				this.connectForUser(null);
				return;
			}

			if (this.currentUserId === state.user.uid && this.nodesRef && this.connectionsRef && this.regionsRef) {
				this.currentAuthUser = state.user;
				this.callbacks.onAuthStateChange(state.user);
				return;
			}

			this.connectForUser(state.user);
		});
	}

	hasRemoteTreeSync() {
		return Boolean(this.nodesRef && this.connectionsRef && this.regionsRef && this.currentUserId);
	}

	disconnect() {
		if (typeof this.nodesUnsubscribe === "function") {
			this.nodesUnsubscribe();
		}

		if (typeof this.connectionsUnsubscribe === "function") {
			this.connectionsUnsubscribe();
		}

		if (typeof this.regionsUnsubscribe === "function") {
			this.regionsUnsubscribe();
		}

		this.nodesUnsubscribe = null;
		this.connectionsUnsubscribe = null;
		this.regionsUnsubscribe = null;
		this.nodesRef = null;
		this.connectionsRef = null;
		this.regionsRef = null;
		this.currentUserId = null;
	}

	connectForUser(user) {
		this.disconnect();

		if (!user) {
			this.currentAuthUser = null;
			this.callbacks.onAuthStateChange(null);
			return;
		}

		this.currentAuthUser = user;
		this.currentUserId = user.uid;
		this.nodesRef = ref(database, `users/${user.uid}/skillTree/nodes`);
		this.connectionsRef = ref(database, `users/${user.uid}/skillTree/connections`);
		this.regionsRef = ref(database, `users/${user.uid}/skillTree/regions`);

		this.nodesUnsubscribe = onValue(this.nodesRef, (snapshot) => {
			this.callbacks.onNodesUpdate(snapshot.val());
		});

		this.connectionsUnsubscribe = onValue(this.connectionsRef, (snapshot) => {
			this.callbacks.onConnectionsUpdate(snapshot.val());
		});

		this.regionsUnsubscribe = onValue(this.regionsRef, (snapshot) => {
			this.callbacks.onRegionsUpdate(snapshot.val());
		});

		this.callbacks.onAuthStateChange(user);
	}

	persistNode(node) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		set(ref(database, `users/${this.currentUserId}/skillTree/nodes/${node.id}`), node);
	}

	deleteNode(nodeId) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		remove(ref(database, `users/${this.currentUserId}/skillTree/nodes/${nodeId}`));
	}

	deleteConnection(connectionId) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		remove(ref(database, `users/${this.currentUserId}/skillTree/connections/${connectionId}`));
	}

	persistRegion(region) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		set(ref(database, `users/${this.currentUserId}/skillTree/regions/${region.id}`), region);
	}

	deleteRegion(regionId) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		remove(ref(database, `users/${this.currentUserId}/skillTree/regions/${regionId}`));
	}

	pushNewNode(nodeData) {
		if (!this.hasRemoteTreeSync()) {
			return null;
		}
		const nodeRef = push(this.nodesRef);
		const node = { ...nodeData, id: nodeRef.key };
		set(nodeRef, node);
		return node;
	}

	pushNewConnection(connectionData) {
		if (!this.hasRemoteTreeSync()) {
			return null;
		}
		const connectionRef = push(this.connectionsRef);
		const connection = { ...connectionData, id: connectionRef.key };
		set(connectionRef, connection);
		return connection;
	}

	pushNewRegion(regionData) {
		if (!this.hasRemoteTreeSync()) {
			return null;
		}
		const regionRef = push(this.regionsRef);
		const region = { ...regionData, id: regionRef.key };
		set(regionRef, region);
		return region;
	}

	setTreeData(nodes, connections, regions) {
		if (!this.hasRemoteTreeSync()) {
			return;
		}
		set(this.nodesRef, nodes);
		set(this.connectionsRef, connections);
		set(this.regionsRef, regions);
	}
}
