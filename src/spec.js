import * as Utils from './mod/utils';
import {domconsole} from './mod/domconsole';

//=================================================================================================
// storage stuff

export let Store = localforage.createInstance({
	name: 'especser',
	storeName: 'sec'
});

export let Data = {
	indexToId: {}, // 4.6.5: #sec-foo
	idToIndex: {}, // #sec-foo: 4.6.5...
	// indexToHTML: {}, // index maps to _processed_ html, only in indexedDB
	indexToFrameIndex: {}, // eg: 2.1.3 maps to 17 where 17 is the index of the corresponding frame inside stack
	stack: [] // contains frames containing data
};

export function indexToPath (index) {
	let pathNums = index.split('.');
	return pathNums.map(
		num => Data.stack[Data.indexToFrameIndex[num]].title
	).join(' | ');
}

export function indexToFrame (index) {
	try {
		return Data.stack[Data.indexToFrameIndex[index]];
	} catch (err) { return null; }
}

var SPEC_URL;

if (window.location.hostname === 'localhost') {
	SPEC_URL = '/spec_cache.html';
	// WE JUST ASSUME SOME STUFF
	// PROBLEM??
}
else {
	SPEC_URL = 'http://crossorigin.me/http://www.ecma-international.org/ecma-262/6.0/index.html';
	// dear speccers, consider allowing cross origin requests
	// yes i called you _speccers_
	// and i wrote i without capitalization (again)
	// come yell at me about it at http://theamountoffucksigive.com
}

//=================================================================================================
// functions to scrape spec

function fetchSpec (url = SPEC_URL) {
	console.log('sending request to %s', url);
	let f = fetch(
		url
	).then(res => res.text())
	.then(html => new DOMParser().parseFromString(html, 'text/html'));
	return f;
}

// replaces multiple simultaneous whitespace characters with single space
function normalize (string) {
	return string.replace(/(?:\n+|\s+)/g, ' ');
}

// *internal* takes list element, secnum (whatever) and extracts a title value
function extractText (el, secnum) {
	let c = $.cl('toc', el);
	let title = '';
	let nextEl = secnum.nextSibling;
	while (nextEl && nextEl.nodeName.toLowerCase() !== 'ol') {
		title += nextEl.textContent;
		nextEl = nextEl.nextSibling;
	}
	return normalize(title.trim());
}

function parseIndex (doc) {
	let elements = $$('span.secnum[id^="sec-"]', doc);
	
	elements.forEach(function (secnum, stackIndex) {

		let index = secnum.textContent;
		let isAnnex = false;
		if (index.startsWith('Annex')) {
			index = index.replace('Annex', '').trim();
			isAnnex = true;
		}

		let path = index.split('.');
		path = path.reduce(function (path, place) {
			let curr = path[path.length - 1];
			path.push(curr + '.' + place);
			return path;
		}, [path.shift()]);

		let id = secnum.firstChild.getAttribute('href').replace('#', '');

		let title = secnum.parentNode.textContent;

		if (isAnnex) {
			title = title.replace('Annex ' + index, '').trim();
		}
		else {
			title = title.replace(index, '').trim();
		}

		let children = [];
		let def = {index, id, title, children, path, stackIndex};
		Data.stack.push(def);
		
		Data.indexToId[index] = id;
		Data.idToIndex[id] = index;
		Data.indexToFrameIndex[index] = stackIndex;

		let parent = path[path.length - 2];
		if (parent) {
			Data.stack[Data.indexToFrameIndex[parent]].children.push(index);
		}

	});

	return doc;

}

function processStack (doc) {
	console.log('starting stack processing of %s frames', Data.stack.length);
	return Promise.all(Data.stack.map( // we have to defer this because if #8.5 refers to #9.5, the index will not be found
		frame => Store.setItem(frame.index, extractMaterial(frame.id, doc))
	)).then(
		_ => Store.setItem('appdata', Data)
	);
}

// *internal* conditionally assigns data-index attribute to element and returns modified element
function assignIndex (el) {
	let id = el.getAttribute('href');
	if (!id || !id.startsWith('#')) return el;
	let index = Data.idToIndex[id.replace('#', '')];
	if (!index) return el;
	el.setAttribute('href', '#' + index);
	el.dataset.index = index;
	el.classList.add('link-newtab');
	return el;
}

function extractMaterial (hash, content) {
	let c = $.id(hash.replace('#', ''), content);
	let f = $.cl('front', c);
	let container = f || c;
	let clone = container.cloneNode(true);
	$$.attr('id', undefined, clone).forEach(el => {el.removeAttribute('id');});
	$$.attr('href^=', '#', clone).forEach(assignIndex);
	return clone.innerHTML;
}

export function update () {
	console.log('update started');
	domconsole.log('fetching latest version of spec and caching locally. this might take a while.')
	return fetchSpec().then(parseIndex).then(processStack).then(
		_ => window.localStorage.setItem('lastIndexed', Date.now())
	).then(
		_ => {
			console.log('stack processed and saved in indexeddb. marked lastindex in localstorage');
			domconsole.log('caching and parsing completed! you can search for stuff and browse the spec now! :) (double click here to hide me)');
			$.id('console').addEventListener('dblclick', function removeMe () {
				this.classList.add('hidden');
				this.removeEventListener('dblclick', removeMe);
			}, false);
		}
	);
}

export function initialize () {
	console.log('initializing especser. we have ignition!');
	if (window.localStorage.getItem('lastIndexed')) {
		return Store.getItem('appdata').then(val => {
			Data = val;
			console.log('retrieved appdata from indexeddb from %s', localStorage.getItem('lastIndexed'));
		});
	}
	console.log('this session is brand new. starting update threads!');
	return update();
}

export function clear () {
	console.log('I have got orders from high command to evacuate all data from the ship.');
	domconsole.log('clearing store. this might take some time.');
	Store.clear().then(_ => localStorage.removeItem('lastIndexed')).then(
		_ => domconsole.log('store was emptied. click update to cache spec again.')
	);
}

//=================================================================================================
// spec usage API to be exposed

const MAX_RESULTS = 8;

// *internal* query to be found in name
function fuzzySearch (name, query, max = MAX_RESULTS) {
	let pos = -1;
	for (let i = 0, len = query.length; i < len; i++) {
		let char = query[i];
		if (!char.trim()) continue; // removing whitespace
		pos = name.indexOf(char, pos+1);
		if (pos === -1) return false;
	}
	return true;
}

// *internal* searches stack to get queried results
function executeSearch (stack, query, max = MAX_RESULTS) {
	if (!query) return [];
	query = query.trim().toLowerCase();
	let results = [], directMatches = 0, fuzzyMatches = 0, totalMatches = 0;
	for (let i = 0, len = stack.length; i < len && totalMatches <= max; i++) {
		let title = stack[i].title.toLowerCase();
		if (title.indexOf(query) >= 0) {
			results.unshift(stack[i]);
			directMatches++;
			totalMatches++;
		}
		else if (fuzzySearch(title, query)) {
			results.push(stack[i]);
			fuzzyMatches++;
			totalMatches++;
		}
  	}
  	return results;
}

export function search (query) {
	return executeSearch(Data.stack, query);
};
