var gulp = require('gulp');
var child_process = require("child_process");

const outdir = 'dist/';

//gulp-typescript hasn't been updated in 2 years and does not support incremental builds anymore
// var ts = require('gulp-typescript');
// var tsProject = ts.createProject('tsconfig.json');
// gulp.task('typescript', function () {
// 	return gulp.src('src/**/*.ts')
// 		.pipe(tsProject())
// 		.pipe(gulp.dest(outdir));
// });

gulp.task('assets', function () {
	return gulp.src(['src/assets/*', 'src/**/*.js', 'src/**/*.json'], { base: "src" })
		.pipe(gulp.dest(outdir))
})

gulp.task('default', gulp.parallel(/*'typescript', */'assets'));

gulp.task('watch', function () {
	//https://stackoverflow.com/questions/17516772/using-nodejss-spawn-causes-unknown-option-and-error-spawn-enoent-err/17537559#17537559
	var npm = (process.platform === "win32" ? "npm.cmd" : "npm");
	const ts = child_process.spawn(npm, ['run', 'ts']);
	//this basically hijacks the console window but i don't care about gulp anymore
	ts.stdout.on('data', function (data) { process.stdout.write(data); });
	ts.stderr.on('data', function (data) { process.stderr.write(data); });
	ts.on('exit', function (code) { console.log("tsc stopped"); });

	return gulp.watch('src/**', { ignoreInitial: false }, gulp.task('default'));
});