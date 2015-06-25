import 'less';
import * as Shortcuts from './mod/shortcuts';
import './mod/sdm';
import './domhandler';
import * as Spec from './spec';
import {domconsole} from './mod/domconsole';

let topbar = $.id('top-bar'), search = $.nam('search');

Shortcuts.register({modifier: 'Ctrl', key: 'P'}, function (e) {
	e.preventDefault();
	topbar.classList.toggle('hidden');
	if (topbar.classList.contains('hidden')) return;
	search.focus();
});

Shortcuts.register({key: 'Esc'}, function (e) {
	e.preventDefault();
	topbar.classList.add('hidden');
});

function window$loaded () {
	if (window.localStorage.getItem('lastIndexed')) {
		Spec.initialize();
		// domconsole.log('hi! enter something in the search bar to search the spec. if you don\'t find stuff, trying clicking clear db and try again.');
	}
	else {
		domconsole.log('hi! especser is an app to search the ECMAScript specification ed6.0. please click update to cache spec for the first time.');
	}
}

window.addEventListener('load', window$loaded);