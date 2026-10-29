@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 exit /b 1

set "PYTHON=python"
if exist ".venv\Scripts\python.exe" set "PYTHON=.venv\Scripts\python.exe"
set "EXE_NAME=PhotoDateRenamer"

%PYTHON% -m pip install -e ".[dev]"
if errorlevel 1 (
    echo No se pudieron instalar las dependencias de compilacion.
    popd
    exit /b 1
)

%PYTHON% -m PyInstaller --clean --noconfirm --onefile --name "%EXE_NAME%" --paths src --add-data "src\photodaterenamer\web;photodaterenamer\web" rename_photos.py
if errorlevel 1 (
    echo Fallo la creacion del ejecutable.
    popd
    exit /b 1
)

for %%F in ("dist\PhotoDateRenamer-*.exe") do (
    if exist "%%~fF" del /q "%%~fF"
)

echo Ejecutable creado en dist\%EXE_NAME%.exe
popd
