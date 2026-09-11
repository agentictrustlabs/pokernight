PokerBench test and train sets go here, fetched from Hugging Face (`RZ412/PokerBench`, no gate):

    for f in preflop_1k_test_set_game_scenario_information.csv preflop_60k_train_set_game_scenario_information.csv \
             postflop_10k_test_set_game_scenario_information.csv postflop_500k_train_set_game_scenario_information.csv; do
      curl -sL -o bench/pokerbench/$f "https://huggingface.co/datasets/RZ412/PokerBench/resolve/main/$f"; done

Then `pnpm bench:preflop` and `pnpm bench:postflop` score the house coach; `pnpm bench:chart` rebuilds both charts.
