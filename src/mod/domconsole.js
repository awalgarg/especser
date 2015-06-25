let c = $.id('console');
export let domconsole = {
	log (...args) {
		c.style.color = '';
		c.textContent = args.join(' ');
	},
	error (...args) {
		c.style.color = 'red';
		c.textContent = args.join(' ');
	},
	clear () {
		c.style.color = '';
		c.textContent = '';
	}
}