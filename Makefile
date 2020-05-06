clean:
	rm -rf dist
	rm -rf build
	rm -rf *.egg-info
	rm -rf app

compile:
	npm run build

build: clean compile
	cp package.json app/
	cp package-lock.json app/
	python setup.py sdist

check-content:
	tar -tvf dist/*.tar.gz

check: build
	twine check dist/*

upload: build
	twine upload dist/*

install:
	pip install -e .

uninstall:
	pip uninstall machine_learning_lab_dashboard machine_learning_lab

.PHONY: clean compile build check upload