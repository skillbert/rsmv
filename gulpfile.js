var gulp = require('gulp');
var child_process = require("child_process");
var through2 = require('through2');

const outdir = 'dist/';
const generateddir = 'generated/';
const opcodesglob = 'src/opcodes/*.json';
const assetsglob = 'src/assets/*';

//gulp-typescript hasn't been updated in 2 years and does not support incremental builds anymore
// var ts = require('gulp-typescript');
// var tsProject = ts.createProject('tsconfig.json');
// gulp.task('typescript', function () {
// 	return gulp.src('src/**/*.ts')
// 		.pipe(tsProject())
// 		.pipe(gulp.dest(outdir));
// });

function generateOpcodeTypes() {
	return through2.obj(function (file, _, cb) {
		if (file.isBuffer()) {
			const opcode_reader = require("./dist/opcode_reader");
			const fs = require("fs");
			const path = require("path");
			const opcodes = JSON.parse(file.contents.toString());
			const typedef = JSON.parse(fs.readFileSync(file.dirname + "/typedef.json", "utf-8"));
			var typesfile =
				"// GENERATED DO NOT EDIT\n" +
				"// This source data is located at '" + path.relative(generateddir, file.path) + "'\n" +
				"// run `npm run filetypes` to rebuild\n\n";
			typesfile += "export type " + file.stem + " = ";
			try {
				typesfile += opcode_reader.buildParser(opcodes, typedef).getTypescriptType("") + ";\n";
			} catch (e) {
				//console.error(e);
				typesfile += "any;\n";
				typesfile += "// " + e.toString().replace(/\n/g, "\n//");
			}
			file.contents = Buffer.from(typesfile);
			file.extname = ".d.ts";
		}
		cb(null, file);
	})
}
gulp.task('filetypes', function () {
	return gulp.src([opcodesglob], { since: gulp.lastRun("filetypes") })
		.pipe(generateOpcodeTypes())
		.pipe(gulp.dest(generateddir));
});

gulp.task('assets', function () {
	return gulp.src([assetsglob, opcodesglob], { base: "src", since: gulp.lastRun("assets") })
		.pipe(gulp.dest(outdir))
});

gulp.task('nontypescript', gulp.parallel('assets', 'filetypes'));

gulp.task('default', gulp.series(
	gulp.task("nontypescript"),
	function typescript(cb) { runTypescript(false, cb); }
));

function runTypescript(watch, donecb) {
	//https://stackoverflow.com/questions/17516772/using-nodejss-spawn-causes-unknown-option-and-error-spawn-enoent-err/17537559#17537559
	var npm = (process.platform === "win32" ? "npm.cmd" : "npm");
	var args = ["run", "ts"];
	if (watch) { args.push("--", "--watch"); }
	const ts = child_process.spawn(npm, args);
	//this basically hijacks the console window but i don't care about gulp anymore
	ts.stdout.on('data', function (data) { process.stdout.write(data); });
	ts.stderr.on('data', function (data) { process.stderr.write(data); });
	ts.on('exit', function (code) {
		console.log("tsc stopped", code);
		if (donecb) {
			donecb(code);
		}
	});
}

gulp.task('watch', function () {
	runTypescript(true);

	return gulp.watch([assetsglob, opcodesglob], { ignoreInitial: false }, gulp.task('nontypescript'),);
});