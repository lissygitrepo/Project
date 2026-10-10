from ingestion import embedding_model, collection


def retrieve_relevant_chunks(query: str, top_k: int = 4) -> list[dict]:
    """
    Embed the student's query and retrieve the top-K most relevant
    chunks from ChromaDB using cosine similarity.
    """
    query_embedding = embedding_model.encode([query]).tolist()

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k,
    )

    chunks = []
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    for doc, meta, dist in zip(documents, metadatas, distances):
        chunks.append({
            "text": doc,
            "source": meta.get("source"),
            "chunk_index": meta.get("chunk_index"),
            "similarity_score": 1 - dist,  # Chroma returns distance; convert to similarity
        })

    return chunks