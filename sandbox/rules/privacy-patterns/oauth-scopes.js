const auth = new OAuth2Client({
  clientId: CLIENT_ID,
  // ruleid: privacy.oauth-broad-scope.google.js
  scopes: ["https://www.googleapis.com/auth/drive"],
});

// ruleid: privacy.oauth-broad-scope.js
const github = { clientId: GH_ID, scope: "repo read:user" };

// ok: privacy.oauth-broad-scope.js
const narrow = { clientId: GH_ID, scope: "read:user public_repo" };

// ok: privacy.oauth-broad-scope.google.js
const readonly = ["https://www.googleapis.com/auth/drive.readonly"];
