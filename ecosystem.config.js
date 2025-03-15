module.exports = {
  apps : [{
    script: 'app.js',
    watch: '.'
  }],

  // deploy : {
  //   production : {
  //     user : 'SSH_USERNAME',
  //     host : 'SSH_HOSTMACHINE',
  //     ref  : 'origin/master',
  //     repo : 'GIT_REPOSITORY',
  //     path : 'DESTINATION_PATH',
  //     'pre-deploy-local': '',
  //     'post-deploy' : 'npm install && pm2 reload ecosystem.config.js --env production',
  //     'pre-setup': ''
  //   }
  // }
  "deploy": {
    "production": {
      "user": "root",
      "host": "localhost",
      "ref": "origin/main",
      "repo": "https://github.com/SignalRegistry/api.git",
      "path": "/root/api",
      'post-deploy' : 'npm install && pm2 reload ecosystem.config.js --env production',
      // "post-deploy": "npm rebuild --update-binary && pm2 startOrRestart ecosystem.json --env production",
      "env": {
        "NODE_ENV": "production"
      }
    },
    // "dev": {
    //   "user": "hsyn",
    //   "host": "localhost",
    //   "ref": "main",
    //   "repo": ".",
    //   "path": "C:\\Users\\hsyn\\Desktop\\GitHub\\Signal Registry\\api",
    //   "post-deploy": "npm rebuild --update-binary && pm2 startOrRestart ecosystem.json --env dev",
    //   "env": {
    //     "NODE_ENV": "dev"
    //   }
    // }
  }
};

// {
//   "apps": [
//     {
//       "name": "node-red",
//       "script": "./node_modules/.bin/node-red",
//       "env": {
//         "DEBUG": "node-red*"
//       }
//     }
//   ],
//   "deploy": {
//     "production": {
//       "user": "boneskull",
//       "host": "some-machine.local",
//       "ref": "origin/master",
//       "repo": "git@github.com:boneskull/some-repo.git",
//       "path": "/var/node-red",
//       "post-deploy": "npm rebuild --update-binary && pm2 startOrRestart ecosystem.json --env production",
//       "env": {
//         "NODE_ENV": "production"
//       }
//     },
//     "dev": {
//       "user": "boneskull",
//       "host": "localhost",
//       "ref": "master",
//       "repo": ".",
//       "path": "/var/node-red",
//       "post-deploy": "npm rebuild --update-binary && pm2 startOrRestart ecosystem.json --env dev",
//       "env": {
//         "NODE_ENV": "dev"
//       }
//     }
//   }
// }
