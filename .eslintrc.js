module.exports = {
    "extends": "airbnb-base",
    "rules": {
        "no-console": "off",
    },
    "overrides": {
        "files": ["**/*.spec.js"],
        "env": {
            "jest": true
        }
    }
};