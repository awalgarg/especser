/*jslint esnext: true*/

import {EventEmitter} from './events';

let Utils = {
	randString () {
		return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, function () {
			return String.fromCharCode(Math.floor(Math.random()*120)+1);
		});
	}
};

export class TabGroup {

	constructor () {
		this.events = new EventEmitter();
		this.tabs = Object.create(null);
		this.store = new WeakMap();
		this.activeTabId = null;
		this.history = [];
	}

	attach (tab) {
		if (!(tab instanceof Tab)) {
			throw new Error('Expected tab to be of instance Tab. Unknown type passed.');
		}
		if (this.store.has(tab)) {
			throw new Error('Tab is already in this TabGroup. Aborting.');
		}
		let id = Utils.randString();
		this.tabs[id] = tab;
		this.store.set(tab, id);
		this.status = {
			type: 'attach',
			id
		};
		return id;
	}

	detach (thing) {
		let {tab, id} = this.find(thing);
		if (this.activeTabId === id) {
			this.close(thing);
		}
		delete this.tabs[id];
		this.status = {
			type: 'detach',
			id
		};
		this.store.delete(tab);
	}

	open (thing) {
		let {tab, id} = this.find(thing);
		if (this.activeTabId === id) return;
		if (this.activeTabId) {
			this.close(this.activeTabId);
		}
		this.activeTabId = id;
		this.status = {
			type: 'open',
			id
		};
	}

	close (thing) {
		let {tab, id} = this.find(thing);
		if (this.activeTabId !== id) return;
		this.activeTabId = null;
		this.status = {
			type: 'close',
			id
		};
	}

	restoreLast () {
		let last;
		for (let i = this.history.length - 1; i >= 0; i--) {
			let desc = this.history[i];
			if (desc.type === 'close' && typeof this.tabs[desc.id] !== 'undefined') {
				last = desc.id;
				break;
			}
		}
		if (!last) {
			return;
		}
		this.open(last);
	}

	find (thing) {
		let tab, id;
		if (typeof thing === 'string') {
			if (typeof this.tabs[thing] === 'undefined') {
				throw new Error('TabGroup contains no tab with id ' + thing);
			}
			tab = this.tabs[thing];
			id = thing;
		} else if (thing instanceof Tab) {
			if (this.store.has(thing)) {
				tab = thing;
				id = this.store.get(thing);
			} else {
				throw new Error('This tab is not a part of this TabGroup.');
			}
		} else {
			throw new Error('Unidentified object passed.');
		}
		return {tab, id};
	}

	set status (stat) {
		let type = stat.type;
		if (!type) throw new Error('Unable to set status. No valid type found.');

		this.history.push(stat);
		this.events.emit(type, stat);
	}

	get status () {
		return this.history[this.history.length - 1];
	}

}

export class Tab {

	constructor (title, description, meta) {
		this.title = title;
		this.description = description;
		this.meta = meta;
	}

	attachTo (group) {
		if (!(group instanceof TabGroup)) {
			throw new Error('Expected group to be instance of TabGroup. Unidentifiable object passed.');
		}
		group.attach(this);
	}

}