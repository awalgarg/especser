export class EventEmitter {

	constructor () {
		this.events = {
			any: []
		};
	}

	on (event, listener) {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event].push(listener);
	}

	once (event, listener) {
		let that = this;
		this.on(event, function oneTimeListener (...data) {
			listener.apply(null, data);
			that.off(event, oneTimeListener);
		});
	}

	off (event, listener) {
		if (!this.events[event]) {
			return;
		}
		if (!listener) {
			this.events[event] = [];
			return;
		}
		let s = this.events[event];
		let i = s.indexOf(listener);
		if (i === -1) {
			return;
		}
		s.splice(i, 1);
	}

	emit (event, ...data) {
		let s = this.events[event];
		if (!s || !s.length) return;
		return Promise.all(
			s.map(
				fn => Promise.resolve(
					fn.apply(null, data)
				)
			)
		);
	}

}
