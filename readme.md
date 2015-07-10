#especser

especser is an in browser app to browse and read the ECMA-262 standard's 6th edition for ECMAScript standardized by ECMAInternational

##why

the es specs are pretty much awful to read. even more awful to navigate. especser presents the spec in an easy on eyes way, with fuzzy searching of the different sections in the spec, tabbed browsing support, internal routing of links etc.

##how

1. goto http://awalGarg.github.io/especser
2. click the update button on the corner
	3. this will fetch the spec directly from http://ecma-international.org/ecma-262/6.0/index.html, pass it through some weirdo functions, store a json map and different parts of the spec in indexedDB
	4. you only have to do this once, and the spec will only be fetched once
5. you can search for stuff you want. use up/down arrow keys to select one of the results and hit enter (or click on one of the search result)
6. press `Ctrl+P` to toggle the top-bar
7. opened tabs are shown on the sidebar on the left.
8. top of the content is shown a path to the present page. you can click on any link in between to open that
9. bottom of the content is shown a list of links to sub-sections for the page if any
10. click on the large index number at the top-left of any content page and copy the url in the address bar to share a perma-link to that section with anyone else
11. links inside the spec are internal. so clicking on any link inside the spec will open that section within the app
12. you can remove the data from indexedDB by clicking the clear store button
13. keep hitting the down arrow key while searching to extract more results
14. if your search starts with `sec: <index1, index2...>`, it will list all those sections and subsections. if a query follows, only sections matching it will be listed.

##running locally

- clone repo
- `npm install`
- `jspm install`
- `iojs build.js`
- start a webserver in the project root
- open the url to the server

##screenshots

ofcourse

![seeing a simple page in especser with some tabs open](http://i.imgur.com/lkIcVon.png)

![searching for something](http://i.imgur.com/xz0eNK2.png)

##license

WTFPL