'use strict';
// MySQL/MariaDB adapter for future approved API modules. This file does not
// automatically connect, migrate, or import any data when Passenger starts.
const IDENTIFIER=/^[a-zA-Z0-9_.-]+$/;
const DBNAME=/^[a-zA-Z0-9_]+$/;
function required(env,key){
 const value=env[key];
 if(typeof value!=='string'||value.length===0)throw new Error('Missing '+key+' setting');
 return value;
}
function mysqlConfig(env=process.env){
 const host=required(env,'RD_DB_HOST');
 const database=required(env,'RD_DB_NAME');
 const user=required(env,'RD_DB_USER');
 const password=required(env,'RD_DB_PASSWORD');
 if(!IDENTIFIER.test(host)||!DBNAME.test(database))
  throw new Error('Invalid MariaDB host or database name');
 const port=Number(env.RD_DB_PORT||3306);
 if(!Number.isSafeInteger(port)||port<1||port>65535)
  throw new Error('Invalid RD_DB_PORT');
 // Bound shared-hosting pools avoid saturating MariaDB during school check-in.
 return {
  host,port,user,password,database,
  charset:'utf8mb4',
  timezone:'Z',
  waitForConnections:true,
  connectionLimit:4,
  queueLimit:100,
  namedPlaceholders:false,
  multipleStatements:false,
  decimalNumbers:false
 };
}
function openPool(env=process.env,driver){
 const mysql=driver||require('mysql2/promise');
 return mysql.createPool(mysqlConfig(env));
}
module.exports={mysqlConfig,openPool};
