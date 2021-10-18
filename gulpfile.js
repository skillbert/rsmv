var gulp = require('gulp');
var ts = require('gulp-typescript');

var tsProject = ts.createProject('tsconfig.json');

const outdir = 'dist/';

gulp.task('typescript', function () {
	return gulp.src('src/**/*.ts')
		.pipe(tsProject())
		.pipe(gulp.dest(outdir));
});

gulp.task('assets', function () {
	return gulp.src(['src/assets/*', 'src/**/*.js', 'src/**/*.json'], { base: "src" })
		.pipe(gulp.dest(outdir))
})

gulp.task('default', gulp.parallel('typescript', 'assets'));

gulp.task('watch', function () {
	return gulp.watch('src/**', { ignoreInitial: false }, gulp.task('default'));
});