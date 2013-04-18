/**
 * Module dependencies.
 */
var ajax = require('request'),
    async = require('async'),
    db = require('./lib/database'),
    express = require('express'), 
    fs = require('fs'),
    habitat = require('habitat'),
    makeAPI = require('./lib/makeapi'),
    middleware = require( "./lib/middleware"),
    mysql = require('mysql'),
    nunjucks = require('nunjucks'),
    path = require('path'),
    routes = require('./routes'),
    s3writer = {}, // STUBBED, PENDING S3 WRITING MODULE
    user = require('./routes/user');

habitat.load();

var app = express(),
    databaseAPI = db(),
    env = new habitat(),
    make = makeAPI(env.get("MAKE_ENDPOINT")),
    nunjucksEnv = new nunjucks.Environment(new nunjucks.FileSystemLoader('views'));

nunjucksEnv.express(app);

// all environments
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.compress());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.cookieSession({secret: env.get('secret')}));
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'learning_projects')));

// set up persona
require('express-persona')(app, { audience: env.get("HOSTNAME") });
if (env.get("NODE_ENV") === "development") {
  app.use(express.errorHandler());
}

// base dir lookup
app.get('/', function(req, res) {
  res.render('index.html', { appURL: env.get("HOSTNAME") } );
});

// learning project listing
app.get('/projects', function(req, res) {
  fs.readdir('learning_projects', function(err, files){
    if(err) { res.end(); return; }
    var projects = [];
    files.forEach( function(e) {
      var id = e.replace('.html','');
      projects.push({
        title: id,
        edit: id,
        view: "/" + id + ".html"
      });
    });
    res.render('gallery.html', {location: "projects", title: 'Learning Projects', projects: projects});
  });
});

// learning project lookup
app.get('/projects/:name', function(req, res) {
  res.render('index.html', {appURL: env.get("HOSTNAME"), pageToLoad: '/' + req.params.name + '.html', HTTP_STATIC_URL: '/'});
});

// "my projects" listing -- USED FOR DEV WORK ATM, MAY NOT BE PERMANENT IN ANY WAY
app.get('/myprojects',
  middleware.checkForPersonaAuth,
  function(req, res) {
    make.search({email: req.session.email}, function(results) {
      var projects = [],
          url;
      results.forEach(function(result){
        url = result.url;
        projects.push({
          title: url,
          edit: url + "/edit",
          view: url
        });
      });
      res.render('gallery.html', {title: 'User Projects', projects: projects});
    });
  }
);

// what do we do when a project request comes in by id (:id route)?
app.param('id', function(req, res, next, id) {
  databaseAPI.find(id, function(err, result) {
    req.pageData = result.sanitizedData;
    next();
  });
});

// remix a published page (from db)
app.get("/remix/:id/edit", function(req, res) {
  // This is quite ugly, and we need a better way to inject data
  // into friendlycode. I'm pretty sure it CAN load from URI, we
  // just need to find out how to tell it to...
  var content = req.pageData.replace(/'/g, '\\\'').replace(/\n/g, '\\n');
  res.render('index.html', {
    appURL: env.get("HOSTNAME"),
    template: content, HTTP_STATIC_URL: '/'
  });
});

// view a published page (from db)
app.get("/remix/:id", function(req, res) {
  res.send(req.pageData);
  res.end();
});

// publish a remix (to the db)
app.post('/publish',
         middleware.checkForPersonaAuth,
         middleware.checkForPublishData,
         middleware.checkForOriginalPage,
         middleware.bleachData(env.get("BLEACH_ENDPOINT")),
         middleware.saveData(databaseAPI, env.get('HOSTNAME')),
         middleware.publishData(s3writer),
         middleware.publishMake(make, env.get('HOSTNAME')),
         middleware.publishMake(make),
  function(req, res) {
    res.json({ 'published-url' : req.publishUrl });
    res.end();
  }
);

// run server
app.listen(env.get("PORT"), function(){
  console.log('Express server listening on port ' + env.get("PORT"));
});
