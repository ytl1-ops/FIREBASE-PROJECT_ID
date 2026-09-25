from merge import Turn, Word, group_utterances, join_words, speaker_at


def test_speaker_at_overlap_and_nearest():
    turns = [Turn(0, 5, 0), Turn(5, 9, 1)]
    assert speaker_at(1, 2, turns) == 0
    assert speaker_at(4.5, 6, turns) == 1  # recouvrement majoritaire
    assert speaker_at(12, 13, turns) == 1  # hors tours : le plus proche
    assert speaker_at(1, 2, []) is None


def test_group_by_speaker_and_pause():
    turns = [Turn(0, 4, 3), Turn(4, 8, 7)]
    words = [
        Word(0.0, 0.4, " Bonjour"),
        Word(0.5, 0.9, " à"),
        Word(1.0, 1.5, " tous."),
        Word(4.2, 4.6, " Merci."),
        Word(7.9, 8.3, " Suite"),  # même locuteur mais pause > 1,5 s
    ]
    out = group_utterances(words, turns)
    assert [(u["speaker"], u["text"]) for u in out] == [
        ("Locuteur 1", "Bonjour à tous."),
        ("Locuteur 2", "Merci."),
        ("Locuteur 2", "Suite"),
    ]
    assert out[0]["start"] == 0 and out[0]["end"] == 1500


def test_without_diarization_single_speaker():
    out = group_utterances([Word(0, 1, " Seul"), Word(1, 2, " intervenant")], [])
    assert out == [{"start": 0, "end": 2000, "speaker": "Locuteur 1", "text": "Seul intervenant"}]


def test_join_words_punctuation():
    assert join_words(["Oui", ",", "c'est", "l'", "escorte", "."]) == "Oui, c'est l'escorte."
