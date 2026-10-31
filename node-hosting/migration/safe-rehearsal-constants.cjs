'use strict';
// Shared immutable whitelist for SQL identifiers in offline replay.
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
module.exports={NAME};
