import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(file=':memory:'){
 const sql=new DatabaseSync(file);if(file===':memory:')sql.exec(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
 function prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}};}
 return {prepare,sql,async batch(commands){sql.exec('BEGIN');try{const results=[];for(const c of commands)results.push(c.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}

