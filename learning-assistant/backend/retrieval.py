from ingestion import embedding_model, collection


def retrieve_relevant_chunks(query: str, top_k: int = 4, topic: str | None = None) -> list[dict]:
    """Embed the query and retrieve the top-K most similar chunks from ChromaDB.
    If `topic` is given, only chunks tagged with that topic are searched."""
    query_embedding = embedding_model.encode([query]).tolist()

    kwargs = {"query_embeddings": query_embedding, "n_results": top_k}
    if topic:
        kwargs["where"] = {"topic": topic}

    results = collection.query(**kwargs)

    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    chunks = []
    for doc, meta, dist in zip(documents, metadatas, distances):
        chunks.append({
            "text": doc,
            "source": meta.get("source"),
            "chunk_index": meta.get("chunk_index"),
            "topic": meta.get("topic"),
            "similarity_score": 1 - dist,  # cosine space: distance = 1 - similarity
        })

    return chunks