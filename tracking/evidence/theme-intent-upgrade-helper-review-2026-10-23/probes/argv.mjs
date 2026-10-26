let raw=''; if(process.argv.includes('--stdin')){for await (const c of process.stdin) raw+=c;}
console.log(JSON.stringify({argv:process.argv.slice(2), stdin: raw? [...raw].map(c=>c.charCodeAt(0)>127?'U+'+c.charCodeAt(0).toString(16):c).join(''):null}));
process.exit(process.argv.includes('--fail')?3:0);
