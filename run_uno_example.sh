# First clone this repo here: ~/Library/Preferences/kicad/scripting/plugins/InteractiveHtmlBom/
# Then run `pip2 install wxPython`

INTERACTIVE_BOM_PATH=`pwd`
GENERATE_INTERACTIVE_BOM="$INTERACTIVE_BOM_PATH/InteractiveHtmlBom/generate_interactive_bom.py"
BOARD_PATH="$INTERACTIVE_BOM_PATH/boards/kicad_arduino_Uno_Rev3-02-TH/arduino_Uno_Rev3-02-TH.kicad_pcb"
echo "Currently here: $INTERACTIVE_BOM_PATH"
echo "Script is here: $GENERATE_INTERACTIVE_BOM"
echo "Board is here: $BOARD_PATH"

export PYTHONPATH="/Applications/KiCad/kicad.app/Contents/Frameworks/python/site-packages:/Library/Frameworks/Python.framework/Versions/2.7/lib/python2.7/site-packages/"
KICAD_PYTHON="/Applications/KiCad/kicad.app/Contents/Frameworks/Python.framework/Versions/2.7/bin"
echo "Moving to: $KICAD_PYTHON"
cd $KICAD_PYTHON

./python $GENERATE_INTERACTIVE_BOM $BOARD_PATH
