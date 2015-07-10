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
